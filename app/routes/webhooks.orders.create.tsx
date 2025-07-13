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

type Address = {
  address1?: string;
  address2?: string;
  city?: string;
  country?: string;
  country_name?: string;
  zip?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
};

function extractShippingDetails(orderData: {
  shipping_address?: Address;
  billing_address?: Address;
  customer?: {
    email?: string;
    id?: any;
    first_name?: string;
    last_name?: string;
    name?: string;
  };
  line_items: any;
  total_price: any;
  shipping_lines: { price?: string | number; title?: string }[];
  id: any;
  order_number: any;
  name: string;
  fulfillment_status: any;
  note: any;
  currency: any;
  total_tax: any;
  tax_lines: { rate: { toString: () => any } }[];
  email: any;
  subtotal_price: any;
}) {
  // 1. מידע משלוח - Shopify (שימוש בכתובת חיוב אם אין כתובת משלוח)
  const shippingAddress =
    orderData.shipping_address || orderData.billing_address || {};
  const billingAddress = orderData.billing_address || {};
  const customer = orderData.customer || {};

  // 2. פריטים - Shopify
  const items = (orderData.line_items || []).map(
    (item: {
      name: any;
      title: any;
      sku: any;
      variant_id: { toString: () => any };
      quantity: any;
      price: any;
      grams: number;
      image: { src: any };
    }) => ({
      name: item.name || item.title || "",
      sku: item.sku || item.variant_id?.toString() || "", // שימוש ב-variant_id אם אין SKU
      quantity: item.quantity || 1,
      price: parseFloat(item.price || "0"),
      weight: item.grams ? item.grams / 1000 : null, // המרה מגרמים לק"ג
      image: item.image?.src || null,
    }),
  );

  // 3. שדות התאמה
  const skuList = items
    .map((item: { sku: any }) => item.sku)
    .filter((sku: any) => sku); // מסנן SKU ריק
  const city = shippingAddress.city || billingAddress.city || null;
  const totalAmount = parseFloat(orderData.total_price || "0");

  // 4. עלות משלוח - Shopify
  const shippingLines = orderData.shipping_lines || [];
  const shippingCost = shippingLines.reduce((sum, line) => {
    return sum + parseFloat(String(line.price ?? "0"));
  }, 0);

  // 5. בדיקה אם ההזמנה דורשת משלוח
  const requiresShipping = (orderData.line_items || []).some(
    (item: { requires_shipping: any }) => item.requires_shipping,
  );

  // Debug logs
  console.log("items", items);
  console.log("shippingAddress", shippingAddress);
  console.log("requiresShipping", requiresShipping);

  return {
    matchFields: {
      skuList,
      city,
      totalAmount,
    },
    orderId: orderData.id,
    orderNumber: orderData.order_number || orderData.name?.replace("#", ""),
    platform: "SHOPIFY",
    fulfillmentStatus: (
      orderData.fulfillment_status || "UNFULFILLED"
    ).toUpperCase(),
    shippingType: requiresShipping ? "DELIVERY" : "UNKNOWN",
    createdAt: FieldValue.serverTimestamp(),

    shipping: {
      title:
        shippingLines[0]?.title ||
        (requiresShipping ? "Standard Shipping" : null),
      instructions: orderData.note || null,
      deliveryTime: null,
      cost: {
        amount: shippingCost,
        formatted: `${shippingCost} ${orderData.currency || "ILS"}`,
        tax: parseFloat(orderData.total_tax || "0"),
        taxRate: orderData.tax_lines?.[0]?.rate?.toString() || "0",
      },
      address: {
        street: shippingAddress.address1 || null,
        number: shippingAddress.address2 || null,
        apt: null,
        city: shippingAddress.city || null,
        country:
          shippingAddress.country || shippingAddress.country_name || null,
        postalCode: shippingAddress.zip || null,
        addressLine2: null,
      },
      recipient: {
        name:
          `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() ||
          shippingAddress.name ||
          `${billingAddress.first_name || ""} ${billingAddress.last_name || ""}`.trim() ||
          billingAddress.name ||
          null,
        phone: shippingAddress.phone || billingAddress.phone || null,
      },
    },

    buyer: {
      email: orderData.email || customer.email || null,
      contactId: customer.id || null,
      name:
        `${billingAddress.first_name || customer.first_name || ""} ${billingAddress.last_name || customer.last_name || ""}`.trim() ||
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

function formatIsraeliPhoneNumber(phoneNumber: string) {
  if (!phoneNumber) return null;

  let digits = phoneNumber.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return null;
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
  const settingsRef = db.collection("whatsapp-settings").doc(instanceId);
  const collectionRef = settingsRef.collection("shipping-records");
  console.log(
    "🗂 will write shipping record to:",
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

  // 5. בדיקת הגדרות ושליחת הודעת אישור אם צריך
  try {
    const settingsSnap = await settingsRef.get();
    const settings = settingsSnap.data();
    if (settings?.order_approved && settings?.order_approved_message) {
      console.log("✅ order_approved is enabled, preparing message");

      // קבלת טלפון מה־payload
      const rawPhone = payload.phone || payload.billing_address?.phone;
      const formattedPhone = formatIsraeliPhoneNumber(rawPhone);
      if (!formattedPhone) {
        console.error("❌ Invalid phone format:", rawPhone);
      } else {
        let approvedMessage = settings.order_approved_message;
        if (settings.include_order_number && payload.order_number) {
          approvedMessage += `\n\nמספר ההזמנה שלך הוא: ${payload.order_number}`;
        }

        // שמירה לתיקיית transactions/incomingOrders/records
        const txRef = db
          .collection("transactions")
          .doc("incomingOrders")
          .collection("records");
        await txRef.add({
          clientId: instanceId,
          number: formattedPhone,
          message: approvedMessage,
          transactionType: "order",
          createdAt: FieldValue.serverTimestamp(),
        });
        console.log(`✅ Order notification queued for ${formattedPhone}`);
      }
    }
  } catch (err) {
    console.error("🔥 Error handling order_approved logic:", err);
  }

  return json({}, { status: 200 });
};
