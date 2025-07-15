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
  console.log("📦 Full fulfillment payload:", {
    id: payload.id,
    order_id: payload.order_id,
    status: payload.status,
    tracking_company: payload.tracking_company,
    tracking_number: payload.tracking_number,
    tracking_url: payload.tracking_url,
    line_items_count: payload.line_items?.length || 0
  });

  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);
  const shopifyOrderId = String(payload.order_id); // Using order_id instead of id
  console.log("🔍 Processing fulfillment for Shopify order ID:", shopifyOrderId);

  try {
    const settingsRef = db.collection("whatsapp-settings").doc(instanceId);
    const shippingRecordsRef = settingsRef.collection("shipping-records");
    const shippingActiveRef = settingsRef.collection("shipping-active");

    // Get the original order
    const orderDoc = await shippingRecordsRef.doc(shopifyOrderId).get();
    if (!orderDoc.exists) {
      console.warn(`❌ Order ${shopifyOrderId} not found in shipping-records`);
      return json({ 
        success: false, 
        message: "Order not found",
        shopifyOrderId 
      }, { status: 404 });
    }

    const orderData = orderDoc.data();
    if (!orderData) {
      console.warn(`❌ Order data for ${shopifyOrderId} is undefined`);
      return json({ 
        success: false, 
        message: "Order data is undefined",
        shopifyOrderId 
      }, { status: 404 });
    }
    console.log("🛒 Found order:", {
      orderId: orderData.orderId,
      orderNumber: orderData.orderNumber
    });

    // Prepare fulfillment data with proper defaults
    const fulfillmentData = {
      ...orderData,
      fulfillment: {
        id: payload.id || null,
        status: payload.status || "fulfilled", // Default status
        tracking: {
          company: payload.tracking_company || null,
          number: payload.tracking_number || null,
          numbers: payload.tracking_numbers || [],
          url: payload.tracking_url || null,
          urls: payload.tracking_urls || [],
        },
        createdAt: payload.created_at || new Date().toISOString(),
        updatedAt: payload.updated_at || new Date().toISOString(),
        lineItems: (payload.line_items || []).map((item: any) => ({
          id: item.id || null,
          title: item.title || "",
          quantity: item.quantity || 0,
          sku: item.sku || "",
        })),
      },
      lastUpdated: FieldValue.serverTimestamp(),
    };

    // Execute the transfer as a batch with ignoreUndefinedProperties
    const batch = db.batch();
    batch.set(shippingActiveRef.doc(shopifyOrderId), fulfillmentData, { 
      merge: true
    });
    batch.delete(shippingRecordsRef.doc(shopifyOrderId));
    await batch.commit();

    console.log(`✅ Order ${(orderData?.orderNumber ?? shopifyOrderId)} moved to shipping-active`);

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
      shopifyOrderId,
      payload: {
        status: payload.status,
        tracking_number: payload.tracking_number,
        line_items: payload.line_items?.length
      }
    });
    return new Response("Internal server error", { status: 500 });
  }
};


