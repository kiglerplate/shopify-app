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

function extractShippingDetails(orderData: any) {
  console.log("🔍 raw Shopify order:", orderData);

  // 1. הכתובת: השתמש ב־shipping_address אם קיים, אחרת ב־billing_address
  const addressObj =
    orderData.shipping_address || orderData.billing_address || {};
  console.log("🏙 resolved address:", addressObj);

  // 2. עלות משלוח כוללת (ILS)
  const shippingCostAmount = parseFloat(
    orderData.current_shipping_price_set?.shop_money?.amount || "0",
  );

  // 3. שורות המשלוח (יתמלאו אם יש)
  const shippingLines = (orderData.shipping_lines || []).map((l: any) => ({
    code: l.code,
    price: parseFloat(l.price),
  }));
  console.log("🚚 shipping lines:", shippingLines);

  // 4. פרטי הפריטים
  const items = (orderData.line_items || []).map((it: any) => ({
    name: it.name,
    sku: it.sku,
    quantity: it.quantity,
    price: parseFloat(it.price),
    weight: it.grams,
    image: it.image?.src || null,
  }));
  console.log("📦 items:", items);

  return {
    orderId: orderData.id,
    orderNumber: orderData.order_number,
    createdAt: FieldValue.serverTimestamp(),

    shipping: {
      cost: {
        amount: shippingCostAmount,
      },
      lines: shippingLines,
      address: {
        street: addressObj.address1 || null,
        number: addressObj.address2 || null,
        city: addressObj.city || null,
        country: addressObj.country || null,
        postalCode: addressObj.zip || null,
      },
      recipient: {
        name:
          `${addressObj.first_name || ""} ${addressObj.last_name || ""}`.trim() ||
          addressObj.name ||
          null,
        phone: addressObj.phone || null,
      },
    },

    items,

    total: {
      subtotal: parseFloat(orderData.subtotal_price || "0"),
      shipping: shippingCostAmount,
      total: parseFloat(orderData.total_price || "0"),
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
