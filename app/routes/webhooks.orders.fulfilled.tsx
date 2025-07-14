// app/routes/webhooks/fulfillments.create.tsx
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

export const action: ActionFunction = async ({ request }) => {
  console.log("🚚 fulfillments.create webhook received");

  // 1. אימות HMAC
  const rawBody = await request.clone().text();
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  const valid = crypto.timingSafeEqual(
    Buffer.from(computedHmac),
    Buffer.from(shopifyHmac),
  );

  if (!valid) {
    console.warn("❌ Invalid HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. עיבוד הנתונים
  const payload = JSON.parse(rawBody);
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);
  const orderId = payload.order_id;

  try {
    const settingsRef = db.collection("whatsapp-settings").doc(instanceId);
    const shippingRecordsRef = settingsRef.collection("shipping-records");
    const shippingActiveRef = settingsRef.collection("shipping-active");

    // 3. שליפת ההזמנה המקורית
    const orderDoc = await shippingRecordsRef.doc(String(orderId)).get();

    if (!orderDoc.exists) {
      console.warn(`Order ${orderId} not found in shipping-records`);
      return json(
        { success: false, message: "Order not found" },
        { status: 404 },
      );
    }

    const orderData = orderDoc.data();

    // 4. הוספת נתוני המעקב
    const fulfillmentData = {
      ...orderData,
      fulfillment: {
        id: payload.id,
        status: payload.status,
        tracking: {
          company: payload.tracking_company,
          number: payload.tracking_number,
          numbers: payload.tracking_numbers || [],
          url: payload.tracking_url,
          urls: payload.tracking_urls || [],
        },
        createdAt: payload.created_at,
        updatedAt: payload.updated_at,
        lineItems: payload.line_items.map((item: any) => ({
          id: item.id,
          title: item.title,
          quantity: item.quantity,
          sku: item.sku,
        })),
      },
      lastUpdated: FieldValue.serverTimestamp(),
    };

    // 5. העברה לקולקציית shipping-active
    const batch = db.batch();

    batch.set(shippingActiveRef.doc(String(orderId)), fulfillmentData);

    batch.delete(shippingRecordsRef.doc(String(orderId)));

    await batch.commit();

    console.log(`✅ Order ${orderId} moved to shipping-active`);
    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("🔥 Error processing fulfillment:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
