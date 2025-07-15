// app/routes/webhooks/fulfillments.create.tsx
import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import { db, FieldValue } from "./../firebase.server";
import type { DocumentReference } from "firebase-admin/firestore";
const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

function formatIsraeliPhoneNumber(phoneNumber: string): string | null {
  if (!phoneNumber) return null;

  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
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
  try {
    console.log("🔍 Checking settings for shipment tracking");
    const settingsSnap = await settingsRef.get();
    const settings = settingsSnap.data();

    if (!settings?.ship_orders1 || !settings?.ship_tracking_message1 || !payload.tracking_url) {
      console.log("ℹ️ Shipment tracking notifications disabled or missing tracking URL");
      return;
    }

    const rawPhone = payload.destination?.phone || orderData.shipping?.recipient?.phone;
    const formattedPhone = formatIsraeliPhoneNumber(rawPhone);

    if (!formattedPhone) {
      console.error("❌ Invalid phone number format:", rawPhone);
      return;
    }

    const trackingMessage = [
      settings.ship_tracking_message1,
      payload.tracking_number && `מספר מעקב: ${payload.tracking_number}`,
      payload.tracking_url && `קישור מעקב: ${payload.tracking_url}`,
      orderData.orderNumber && `מספר הזמנה: ${orderData.orderNumber}`
    ].filter(Boolean).join('\n');

    const txRef = db.collection("transactions")
      .doc("incomingOrders")
      .collection("records");

    await txRef.add({
      clientId: instanceId,
      number: formattedPhone,
      message: trackingMessage,
      transactionType: "shipment_tracking",
      trackingNumber: payload.tracking_number,
      trackingUrl: payload.tracking_url,
      orderNumber: orderData.orderNumber,
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`✅ Tracking notification queued for ${formattedPhone}`);
  } catch (err) {
    console.error("🔥 Failed to send tracking notification:", err);
  }
}

export const action: ActionFunction = async ({ request }) => {
  console.log("🚚 Fulfillment created webhook received");

  // HMAC Validation
  const rawBody = await request.clone().text();
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(computedHmac), Buffer.from(shopifyHmac))) {
    console.warn("❌ HMAC validation failed");
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  console.log("📦 Full fulfillment payload:", JSON.stringify(payload, null, 2));

  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);
  
  // נשתמש ב-ID הפנימי של ההזמנה מ-Shopify
  const shopifyOrderId = String(payload.id); // "6381449445601"
  console.log("🔍 Processing fulfillment for Shopify order ID:", shopifyOrderId);

  try {
    const settingsRef = db.collection("whatsapp-settings").doc(instanceId);
    const shippingRecordsRef = settingsRef.collection("shipping-records");
    const shippingActiveRef = settingsRef.collection("shipping-active");

    // נחפש את ההזמנה לפי ה-ID הפנימי של Shopify
    const orderDoc = await shippingRecordsRef.doc(shopifyOrderId).get();

    if (!orderDoc.exists) {
      console.warn(`❌ Order with Shopify ID ${shopifyOrderId} not found in shipping-records`);
      console.log("Available fields in payload:", Object.keys(payload));
      return json({ 
        success: false, 
        message: "Order not found",
        shopifyOrderId: shopifyOrderId
      }, { status: 404 });
    }

    const orderData = orderDoc.data();
    // console.log("🛒 Original order data:", JSON.stringify({
    //   firestoreDocId: orderDoc.id,
    //   shopifyOrderId: orderData.orderId,
    //   orderNumber: orderData.orderNumber
    // }, null, 2));

    // Prepare fulfillment data
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
        lineItems: (payload.line_items || []).map((item: any) => ({
          id: item.id,
          title: item.title,
          quantity: item.quantity,
          sku: item.sku,
        })),
      },
      lastUpdated: FieldValue.serverTimestamp(),
    };

    // console.log("🚛 Fulfillment data to save:", JSON.stringify({
    //   fulfillment: fulfillmentData.fulfillment,
    //   shopifyOrderId: fulfillmentData.orderId,
    //   orderNumber: fulfillmentData.orderNumber
    // }, null, 2));

    // Execute the transfer as a batch
    const batch = db.batch();
    batch.set(shippingActiveRef.doc(shopifyOrderId), fulfillmentData);
    batch.delete(shippingRecordsRef.doc(shopifyOrderId));
    await batch.commit();

    // console.log(`✅ Order ${orderData.orderNumber || shopifyOrderId} (Shopify ID: ${shopifyOrderId}) moved to shipping-active`);

    // Send tracking notification if enabled
    await sendTrackingNotification({
      settingsRef,
      payload,
      orderData,
      instanceId
    });

    return json({ success: true }, { status: 200 });

  } catch (error) {
    console.error("🔥 Error processing fulfillment:", {
      error: error instanceof Error ? error.message : String(error),
      shopifyOrderId: shopifyOrderId,
      payloadSummary: {
        fulfillment_id: payload.id,
        tracking: payload.tracking_number
      }
    });
    return new Response("Internal server error", { status: 500 });
  }
};