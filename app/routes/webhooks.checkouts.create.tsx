// webhooks.checkouts.create.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
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
      name: `${billingAddress.first_name || ""} ${billingAddress.last_name || ""}`.trim() ||
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

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("🛒 carts/create webhook received");

  const rawBody = await request.clone().text();
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(computedHmac), Buffer.from(shopifyHmac))) {
    console.warn("❌ carts/create — invalid HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);

  try {
    const cartData = extractCartDetails(payload);
    const settingsRef = db.collection("whatsapp-settings").doc(instanceId);

    // 1. Save pending checkout with normalized phone
    await settingsRef
      .collection("pendingCheckouts")
      .doc(String(payload.id))
      .set({
        status: "pending",
        phone: cartData.customer.phone,
        email: cartData.customer.email,
        cartToken: cartData.cartToken,
        customerName: cartData.customer.name,
        items: cartData.items.map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          price: i.price,
        })),
        totalPrice: cartData.totals.total,
        abandoned_checkout_url: cartData.abandoned_checkout_url,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    // 2. Save full cart data
    await settingsRef
      .collection("order_abandoned")
      .doc(String(payload.id))
      .set({
        ...cartData,
        createdAt: FieldValue.serverTimestamp(),
      });

    // 3. Update abandoned customer record
    if (cartData.customer.phone) {
      const customerData = {
        ...cartData.customer,
        lastAbandonedAt: FieldValue.serverTimestamp(),
        abandonedCartIds: FieldValue.arrayUnion(payload.id),
        address: {
          street: cartData.shipping_address.street || cartData.billing_address.street || "",
          city: cartData.shipping_address.city || cartData.billing_address.city || "",
          postalCode: cartData.shipping_address.postalCode || cartData.billing_address.postalCode || "",
        },
        totalAbandoned: FieldValue.increment(1),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      await settingsRef
        .collection("abandoned_customers")
        .doc(cartData.customer.phone)
        .set(customerData, { merge: true });
    }

    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("🔥 Error processing abandoned cart:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
