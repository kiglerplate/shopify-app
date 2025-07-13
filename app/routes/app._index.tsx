// app/routes/webhooks/orders.create.tsx
import { Buffer } from "buffer";
import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

// ייבוא של ה־db ושל admin (FieldValue) מתוך firebase.server.js
import { db, admin } from "./../firebase.server";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

function normalizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * מחלץ את פרטי ההזמנה למבנה שאתה צריך
 */
function extractShippingDetails(orderData: any) {
  const shippingInfo = orderData.shippingInfo || {};
  const logistics = shippingInfo.logistics || {};
  const shippingCost = shippingInfo.cost || {};
  const destination = logistics.shippingDestination || {};
  const pickup = logistics.pickupDetails || {};

  const isPickup = !!pickup.address;
  const isDirectShipping = !!destination.address;
  const address = isPickup ? pickup.address : destination.address;
  const contact = isPickup ? pickup.contactDetails : destination.contactDetails;
  const lineItems = orderData.line_items || []; // שים לב: בווב־הוק השדה נקרא line_items

  const items = lineItems.map((item: any) => ({
    name: item.name || "",
    sku: item.sku || "",
    quantity: item.quantity || 1,
    price: parseFloat(item.price || "0"),
    weight: item.grams ?? null,
    image: item.image ? item.image.src : null,
  }));

  const skuList = items.map((i: { sku: any }) => i.sku);
  const city = address?.city || null;
  const totalAmount = parseFloat(orderData.total_price || "0");

  return {
    matchFields: {
      skuList,
      city,
      totalAmount,
    },
    orderId: orderData.id,
    orderNumber: orderData.order_number,
    platform: "SHOPIFY",
    fulfillmentStatus: orderData.fulfillment_status || "UNKNOWN",
    shippingType: isPickup
      ? "PICKUP"
      : isDirectShipping
        ? "DELIVERY"
        : "UNKNOWN",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),

    shipping: {
      title: shippingInfo.title || null,
      instructions: logistics.instructions || null,
      deliveryTime: logistics.deliveryTime || null,
      cost: {
        amount: parseFloat(shippingCost?.price?.amount || "0"),
        formatted: shippingCost?.price?.formattedAmount || "",
        tax: parseFloat(shippingCost?.taxDetails?.totalTax?.amount || "0"),
        taxRate: shippingCost?.taxDetails?.taxRate || "0",
      },
      address: {
        street: address?.address1 || null,
        number: address?.address_number || null,
        apt: address?.address2 || null,
        city: address?.city || null,
        country: address?.country || null,
        postalCode: address?.zip || null,
        addressLine2: address?.address2 || null,
      },
      recipient: {
        name: `${contact?.first_name || ""} ${contact?.last_name || ""}`.trim(),
        phone: contact?.phone || null,
      },
    },

    buyer: {
      email: orderData.email || null,
      contactId: orderData.customer?.id || null,
      name: `${orderData.billing_address?.first_name || ""} ${orderData.billing_address?.last_name || ""}`.trim(),
    },

    items,

    total: {
      subtotal: parseFloat(orderData.subtotal_price || "0"),
      shipping: parseFloat(orderData.total_shipping_price || "0"),
      total: parseFloat(orderData.total_price || "0"),
    },
  };
}

export const action: ActionFunction = async ({ request }) => {
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
  if (!valid) {
    console.warn("❌ invalid HMAC", { computedHmac, shopifyHmac });
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. פרסור ה־payload ויצירת instanceId
  const payload = JSON.parse(rawBody);
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);

  // 3. חילוץ הנתונים למבנה הרצוי
  const shippingData = extractShippingDetails(payload);

  // 4. שמירה ל־Firestore
  const collectionRef = db
    .collection("whatsapp-settings")
    .doc(instanceId)
    .collection("shipping-records");

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
