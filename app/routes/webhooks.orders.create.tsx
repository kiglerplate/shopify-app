// app/routes/webhooks/orders.create.tsx
import { Buffer } from "buffer";
import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

import { db, FieldValue } from "./../firebase.server";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

function normalizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractShippingDetails(orderData: {
  shipping_address: {
    city?: string;
    address1?: string;
    address2?: string;
    country?: string;
    zip?: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    phone?: string;
    [key: string]: any;
  };
  billing_address: {
    first_name?: string;
    last_name?: string;
    name?: string;
    [key: string]: any;
  };
  customer: {
    id?: string;
    email?: string;
    name?: string;
    [key: string]: any;
  };
  line_items: any;
  total_price: any;
  shipping_line: {
    price?: string;
    title?: string;
    [key: string]: any;
  };
  id: any;
  order_number: any;
  name: string;
  fulfillment_status: any;
  note: any;
  currency: any;
  total_tax: any;
  email: any;
  subtotal_price: any;
}) {
  // 1. מידע משלוח - Shopify
  const shippingAddress = orderData.shipping_address || {};
  const billingAddress = orderData.billing_address || {};
  const customer = orderData.customer || {};

  // 2. פריטים - Shopify
  const items = (orderData.line_items || []).map(
    (item: {
      name: any;
      title: any;
      sku: any;
      quantity: any;
      price: any;
      grams: number;
      image: { src: any };
    }) => ({
      name: item.name || item.title || "",
      sku: item.sku || "",
      quantity: item.quantity || 1,
      price: parseFloat(item.price || "0"),
      weight: item.grams ? item.grams / 1000 : null, // ממיר גרמים לק"ג
      image: item.image?.src || null,
    }),
  );

  // 3. שדות התאמה
  const skuList = items.map((item: { sku: any }) => item.sku);
  const city = shippingAddress.city || null;
  const totalAmount = parseFloat(orderData.total_price || "0");

  // 4. עלות משלוח - Shopify
  const shippingLine = orderData.shipping_line || {};
  const shippingCost = parseFloat(shippingLine.price || "0");

  // Debug logs
  console.log("items", items);
  console.log("shippingAddress", shippingAddress);
  console.log("orderData", orderData);

  return {
    matchFields: {
      skuList,
      city,
      totalAmount,
    },
    orderId: orderData.id,
    orderNumber: orderData.order_number || orderData.name?.replace("#", ""),
    platform: "SHOPIFY", // שונה מ-WIX ל-SHOPIFY
    fulfillmentStatus: (
      orderData.fulfillment_status || "UNKNOWN"
    ).toUpperCase(),
    shippingType: shippingAddress ? "DELIVERY" : "UNKNOWN", // Shopify לא תומך ב-PICKUP באותו אופן
    createdAt: FieldValue.serverTimestamp(),

    shipping: {
      title: shippingLine.title || null,
      instructions: orderData.note || null,
      deliveryTime: null, // לא זמין ב-Shopify
      cost: {
        amount: shippingCost,
        formatted: `${shippingCost} ${orderData.currency || "USD"}`,
        tax: parseFloat(orderData.total_tax || "0"),
        taxRate: "0", // לא זמין ישירות ב-Shopify
      },
      address: {
        street: shippingAddress.address1 || null,
        number: shippingAddress.address2 || null,
        apt: null, // לא זמין ב-Shopify
        city: shippingAddress.city || null,
        country: shippingAddress.country || null,
        postalCode: shippingAddress.zip || null,
        addressLine2: null, // לא זמין ב-Shopify
      },
      recipient: {
        name:
          `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() ||
          shippingAddress.name ||
          null,
        phone: shippingAddress.phone || null,
      },
    },

    buyer: {
      email: orderData.email || customer.email || null,
      contactId: customer.id || null,
      name:
        `${billingAddress.first_name || ""} ${billingAddress.last_name || ""}`.trim() ||
        billingAddress.name ||
        customer.name ||
        null,
    },

    items,

    total: {
      subtotal: parseFloat(orderData.subtotal_price || "0"),
      shipping: shippingCost,
      total: totalAmount,
    },
  };
}
export const action: ActionFunction = async ({ request }) => {
  console.log("🚀 orders.create webhook received");

  // 1. אימות HMAC
  const rawBody = await request.clone().text();
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  const hmacBuf = Buffer.from(shopifyHmac, "base64");
  const computedBuf = Buffer.from(computedHmac, "base64");
  let valid = false;
  if (hmacBuf.length === computedBuf.length) {
    try {
      valid = crypto.timingSafeEqual(hmacBuf, computedBuf);
    } catch {
      valid = false;
    }
  }
  console.log("🔐 HMAC valid?", valid);
  if (!valid) {
    console.warn("❌ invalid HMAC", { computedHmac, shopifyHmac });
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. פרסור ה־payload ויצירת instanceId
  const payload = JSON.parse(rawBody);
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);
  console.log("🏷 shopDomain:", shopDomain, "→ instanceId:", instanceId);
  console.log("📦 payload.id:", payload.id);

  // 3. חילוץ הנתונים למבנה הרצוי
  const shippingData = extractShippingDetails(payload);

  // 4. שמירה ל־Firestore
  const collectionRef = db
    .collection("whatsapp-settings")
    .doc(instanceId)
    .collection("shipping-records");
  console.log(
    "🗂 will write to:",
    collectionRef.path,
    "/doc:",
    String(payload.id),
  );

  try {
    await collectionRef
      .doc(String(payload.id))
      .set(shippingData, { merge: true });

    console.log(
      `✅ Shipping record for order ${payload.id} saved under ${instanceId}`,
    );
  } catch (e) {
    console.error("🔥 Error saving shipping data:", e);
    return new Response("Error writing to database", { status: 500 });
  }

  return json({}, { status: 200 });
};
