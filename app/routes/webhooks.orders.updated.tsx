//webhooks.orders.updated.tsx
// app/routes/webhooks/orders.update.tsx
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
  // 1. HMAC validation
  const rawBody = await request.clone().text();
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  if (!crypto.timingSafeEqual(Buffer.from(computedHmac), Buffer.from(shopifyHmac))) {
    console.warn("❌ orders/update — invalid HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse payload
  const payload = JSON.parse(rawBody);
  console.log("🔄 orders/update payload:", payload);

  // 3. Only handle fulfillment cancel events
  // Shopify sets fulfillment_status to null when canceled
  if (payload.fulfillment_status !== null) {
    return json({ success: true, message: "Not a cancellation event" }, { status: 200 });
  }

  // 4. Setup Firestore refs
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);
  const settingsRef = db.collection("whatsapp-settings").doc(instanceId);
  const activeRef = settingsRef.collection("shipping-active");
  const recordsRef = settingsRef.collection("shipping-records");

  const orderId = String(payload.id || payload.order_id);

  try {
    // 5. Fetch active shipment data
    const activeSnap = await activeRef.doc(orderId).get();
    if (!activeSnap.exists) {
      console.warn(`Order ${orderId} not found in shipping-active`);
      return json({ success: false, message: "Active shipment not found" }, { status: 404 });
    }
    const data = activeSnap.data();

    // 6. Move document back to shipping-records
    const batch = db.batch();
    // write to records
    batch.set(recordsRef.doc(orderId), {
      ...data,
      lastUpdated: FieldValue.serverTimestamp(),
    });
    // delete from active
    batch.delete(activeRef.doc(orderId));
    await batch.commit();

    console.log(`↩️  Moved order ${orderId} from shipping-active back to shipping-records`);
    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("🔥 orders/update error:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
