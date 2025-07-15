// app/routes/webhooks/fulfillments.create.ts
import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import { db, FieldValue } from "../firebase.server";
import type { DocumentReference } from "firebase-admin/firestore";
const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

function formatIsraeliPhoneNumber(phoneNumber: string): string | null {
  if (!phoneNumber) return null;
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0"))   return `972${digits.slice(1)}`;
  return null;
}

function normalizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function sendTrackingNotification({
  settingsRef,
  payload,
  orderData,
  instanceId
}: {
  settingsRef: DocumentReference,
  payload: any,
  orderData: any,
  instanceId: string
}) {
  const settingsSnap = await settingsRef.get();
  const settings = settingsSnap.data();

  if (!settings?.ship_orders1 ||
      !settings?.ship_tracking_message1 ||
      !payload.tracking_url
  ) {
    return;
  }

  const rawPhone = payload.destination?.phone || orderData.shipping?.recipient?.phone;
  const formattedPhone = formatIsraeliPhoneNumber(rawPhone);
  if (!formattedPhone) return;

  const trackingMessage = [
    settings.ship_tracking_message1,
    payload.tracking_number && `מספר מעקב: ${payload.tracking_number}`,
    payload.tracking_url    && `קישור מעקב: ${payload.tracking_url}`,
    orderData.orderNumber   && `מספר הזמנה: ${orderData.orderNumber}`
  ].filter(Boolean).join("\n");

  await db
    .collection("transactions")
    .doc("incomingOrders")
    .collection("records")
    .add({
      clientId:         instanceId,
      number:           formattedPhone,
      message:          trackingMessage,
      transactionType:  "shipment_tracking",
      trackingNumber:   payload.tracking_number,
      trackingUrl:      payload.tracking_url,
      orderNumber:      orderData.orderNumber,
      createdAt:        FieldValue.serverTimestamp(),
    });
}

export const action: ActionFunction = async ({ request }) => {
  // 1. HMAC validation
  const rawBody   = await request.clone().text();
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  if (!crypto.timingSafeEqual(Buffer.from(computedHmac), Buffer.from(shopifyHmac))) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. פרסינג ו‑destructuring של כל השדות המגיעים
  const payload = JSON.parse(rawBody);
  const {
    id:                fulfillmentId,
    order_id:          orderId,
    status,
    created_at,
    updated_at,
    tracking_company,
    tracking_number,
    tracking_numbers = [],
    tracking_url,
    tracking_urls    = [],
    line_items       = [],
  } = payload;

  // 3. הכנת קישורי Firebase
  const shopDomain       = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId       = normalizeId(shopDomain);
  const settingsRef      = db.collection("whatsapp-settings").doc(instanceId);
  const shippingRecords  = settingsRef.collection("shipping-records");
  const shippingActive   = settingsRef.collection("shipping-active");

  console.log("Processing fulfillment for order:", orderId, "with fulfillment ID:", fulfillmentId);
  // 4. קבלת ההזמנה הקיימת לפי order_id
  const orderSnap = await shippingRecords.doc(String(orderId)).get();


  if (!orderSnap.exists) {
    return json({ success: false, message: "Order not found" }, { status: 404 });
  }
  const orderData = orderSnap.data();

  // 5. בניית מבנה הנתונים של ה‑fulfillment
  const fulfillmentData = {
    ...orderData,
    fulfillment: {
      id:        fulfillmentId,
      status,                               // עכשיו שדה מוגדר מתוך payload
      tracking: {
        company: tracking_company,
        number:  tracking_number,
        numbers: tracking_numbers,
        url:     tracking_url,
        urls:    tracking_urls,
      },
      createdAt: created_at,
      updatedAt: updated_at,
      lineItems: line_items.map((item: any) => ({
        id:       item.id,
        title:    item.title,
        quantity: item.quantity,
        sku:      item.sku,
      })),
    },
    lastUpdated: FieldValue.serverTimestamp(),
  };

  // 6. עדכון במאגר כפעולה אטומית
  const batch = db.batch();
  batch.set(shippingActive.doc(String(orderId)), fulfillmentData);
  batch.delete(shippingRecords.doc(String(orderId)));
  await batch.commit();

  // 7. שליחת הודעת מעקב במידת הצורך
  await sendTrackingNotification({
    settingsRef,
    payload,
    orderData,
    instanceId
  });

  return json({ success: true }, { status: 200 });
};
