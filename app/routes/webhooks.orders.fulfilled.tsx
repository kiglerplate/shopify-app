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

  // Extract order identifier from multiple possible fields
  const orderIdentifier = payload.order_id || 
                        payload.name?.replace("#", "") || 
                        payload.admin_graphql_api_id?.split("/").pop();

  if (!orderIdentifier) {
    console.error("❌ No valid order identifier found in payload");
    await db.collection("webhook-errors").add({
      type: "missing_order_identifier",
      payload: payload,
      timestamp: FieldValue.serverTimestamp()
    });
    return json(
      { success: false, message: "Missing order identifier" },
      { status: 400 }
    );
  }

  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);
  
  try {
    const settingsRef = db.collection("whatsapp-settings").doc(instanceId);
    const shippingRecordsRef = settingsRef.collection("shipping-records");
    const shippingActiveRef = settingsRef.collection("shipping-active");

    // Try to find order by multiple fields
    let orderDoc;
    const queries = [
      shippingRecordsRef.where("orderNumber", "==", orderIdentifier).limit(1),
      shippingRecordsRef.where("orderId", "==", orderIdentifier).limit(1),
      shippingRecordsRef.where("name", "==", `#${orderIdentifier}`).limit(1)
    ];

    for (const query of queries) {
      const snapshot = await query.get();
      if (!snapshot.empty) {
        orderDoc = snapshot.docs[0];
        break;
      }
    }

    if (!orderDoc) {
      console.error(`❌ Order ${orderIdentifier} not found in any field`);
      return json(
        { success: false, message: "Order not found" },
        { status: 404 }
      );
    }

    const orderData = orderDoc.data();
    const fulfillmentData = buildFulfillmentData(orderData, payload);


function removeUndefined(obj: any): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, v === Object(v) ? removeUndefined(v) : v])
  );
}

await shippingActiveRef.doc(orderDoc.id).set(
  removeUndefined(fulfillmentData),
  { merge: true }
);


    console.log(`✅ Fulfillment processed for order ${orderIdentifier}`);
    return json({ success: true });

  } catch (error) {
    console.error("🔥 Fulfillment processing failed:", {
      // error: error.message,
      orderIdentifier,
      payload: {
        id: payload.id,
        status: payload.status,
        tracking: payload.tracking_number
      }
    });
    return new Response("Server error", { status: 500 });
  }
};

// החלף את הפונקציה buildFulfillmentData בגרסה זו
function buildFulfillmentData(orderData: any, payload: any) {
  // פונקציית עזר לטיפול ב-undefined
  const safe = (value: any, fallback: any = null) => 
    value !== undefined ? value : fallback;

  return {
    ...orderData,
    fulfillment: {
      id: safe(payload.id),
      status: safe(payload.status, 'unknown'),
      tracking: {
        company: safe(payload.tracking_company, 'unknown'),
        number: safe(payload.tracking_number, generateTrackingNumber()),
        url: safe(payload.tracking_url, generateTrackingUrl(payload.id)),
        numbers: safe(payload.tracking_numbers, []),
        urls: safe(payload.tracking_urls, [])
      },
      createdAt: safe(payload.created_at, new Date().toISOString()),
      updatedAt: safe(payload.updated_at, new Date().toISOString()),
      lineItems: (payload.line_items || []).map((item: any) => ({
        id: safe(item.id),
        title: safe(item.title, ''),
        quantity: safe(item.quantity, 0),
        sku: safe(item.sku, '')
      }))
    },
    lastUpdated: FieldValue.serverTimestamp()
  };
}

// ואז השתמש כך:
// (Removed duplicate code block that referenced orderDoc out of scope)

function generateTrackingNumber(): any {
  throw new Error("Function not implemented.");
}

function generateTrackingUrl(id: any): string {
  // Placeholder implementation, replace with your logic if needed
  return `https://tracking.example.com/${id}`;
}

