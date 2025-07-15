// app/routes/webhooks/checkouts.update.tsx
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

function formatIsraeliPhoneNumber(phone: string): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, "");
  if (/^05\d{8}$/.test(cleaned)) return `+972${cleaned.slice(1)}`;
  if (/^9725\d{8}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\d{10,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

function extractCartDetails(cartData: any) {
  const billingAddress = cartData.billing_address || {};
  const shippingAddress = cartData.shipping_address || {};
  const customer = cartData.customer || {};

  // Prioritize billing phone, then shipping, then customer, then cartData.phone
  const rawPhone =
    billingAddress.phone ||
    shippingAddress.phone ||
    customer.phone ||
    cartData.phone ||
    null;
  const formattedPhone = rawPhone ? formatIsraeliPhoneNumber(rawPhone) : null;

  const items = (cartData.line_items || []).map((item: any) => ({
    name: item.title || item.name || "",
    sku: item.sku || item.variant_id?.toString() || "",
    quantity: item.quantity || 1,
    price: parseFloat(item.price || "0"),
    weight: item.grams ? item.grams / 1000 : null,
    variant_id: item.variant_id || null,
    product_id: item.product_id || null,
  }));

  return {
    cartId: cartData.id,
    cartToken: cartData.token || cartData.cart_token,
    abandonedAt: cartData.updated_at || new Date().toISOString(),
    customer: {
      email: cartData.email || customer.email || "",
      phone: formattedPhone || "",
      name:
        `${billingAddress.first_name || ""} ${billingAddress.last_name || ""}`.trim() ||
        `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}`.trim() ||
        customer.name || "",
      customer_id: customer.id || null,
    },
    billing_address: {
      street: billingAddress.address1 || "",
      city: billingAddress.city || "",
      country: billingAddress.country || "",
      postalCode: billingAddress.zip || "",
      phone: billingAddress.phone || "",
    },
    shipping_address: {
      street: shippingAddress.address1 || "",
      city: shippingAddress.city || "",
      country: shippingAddress.country || "",
      postalCode: shippingAddress.zip || "",
      phone: shippingAddress.phone || "",
    },
    items,
    totals: {
      subtotal: parseFloat(cartData.subtotal_price || "0"),
      total: parseFloat(cartData.total_price || "0"),
      taxes: parseFloat(cartData.total_tax || "0"),
      currency: cartData.currency || "USD",
    },
    abandoned_checkout_url: cartData.abandoned_checkout_url || "",
    note: cartData.note || "",
    created_at: cartData.created_at || new Date().toISOString(),
  };
}

export const action: ActionFunction = async ({ request }) => {
  console.log("🔄 checkouts/update webhook received");

  // HMAC validation
  const rawBody = await request.clone().text();
  console.log("📦 checkouts/update raw body:", rawBody);
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(computedHmac), Buffer.from(shopifyHmac))) {
    console.warn("❌ checkouts/update — invalid HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  // Parse payload
  const payload = JSON.parse(rawBody);
  console.log("📦 checkouts/update parsed payload:", payload);

  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);
  const checkoutId = String(payload.id);

  const cartData = extractCartDetails(payload);
  const settingsRef = db.collection("whatsapp-settings").doc(instanceId);

  // Update pending checkouts (merge only changed fields)
  await settingsRef
    .collection("pendingCheckouts")
    .doc(checkoutId)
    .set(
      {
        phone: cartData.customer.phone,
        email: cartData.customer.email,
        customerName: cartData.customer.name,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  // Update full abandoned cart record
  await settingsRef
    .collection("order_abandoned")
    .doc(checkoutId)
    .set(
      { ...cartData, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

  return json({ success: true }, { status: 200 });
};
