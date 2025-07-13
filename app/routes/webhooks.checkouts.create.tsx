// app/routes/webhooks/carts.create.tsx
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

  // הסרת כל התווים שאינם מספרים
  const cleaned = phone.replace(/\D/g, "");

  // טלפון ישראלי שמתחיל ב-05
  if (cleaned.match(/^05\d{8}$/)) {
    return `+972${cleaned.slice(1)}`;
  }

  // טלפון ישראלי עם קידומת 972
  if (cleaned.match(/^9725\d{8}$/)) {
    return `+${cleaned}`;
  }

  // טלפון בינלאומי עם +
  if (cleaned.match(/^\d{10,15}$/)) {
    return `+${cleaned}`;
  }

  return null;
}

function extractCartDetails(cartData: any) {
  const billingAddress = cartData.billing_address || {};
  const shippingAddress = cartData.shipping_address || {};
  const customer = cartData.customer || {};

  // טלפון - עדיפות: כתובת משלוח > כתובת חיוב > לקוח
  const phone =
    shippingAddress.phone || billingAddress.phone || customer.phone || null;

  const items = (cartData.line_items || []).map((item: any) => ({
    name: item.title || item.name || "",
    sku: item.sku || item.variant_id?.toString() || "",
    quantity: item.quantity || 1,
    price: parseFloat(item.price || "0"),
    weight: item.grams ? item.grams / 1000 : null, // גרמים לק"ג
    image: null, // ב-Shopify אין לינק לתמונה ישירות מפריטי עגלה
    variant_id: item.variant_id || null,
    product_id: item.product_id || null,
  }));

  return {
    cartId: cartData.id,
    cartToken: cartData.token || cartData.cart_token,
    abandonedAt: cartData.updated_at || new Date().toISOString(),
    customer: {
      email: cartData.email || customer.email || "",
      phone: phone,
      name: `${shippingAddress.first_name || billingAddress.first_name || customer.first_name || ""} ${
        shippingAddress.last_name ||
        billingAddress.last_name ||
        customer.last_name ||
        ""
      }`.trim(),
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

  // אימות HMAC
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
    console.warn("❌ carts/create — invalid HMAC");
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain")!;
  const instanceId = normalizeId(shopDomain);

  try {
    const cartData = extractCartDetails(payload);
    const settingsRef = db.collection("whatsapp-settings").doc(instanceId);

    // 1. שמירת עגלה נטושה
    await settingsRef
      .collection("order_abandoned")
      .doc(String(payload.id))
      .set({
        ...cartData,
        createdAt: FieldValue.serverTimestamp(),
      });

    // 2. שמירת/עדכון לקוח נטוש
    const formattedPhone = cartData.customer.phone
      ? formatIsraeliPhoneNumber(cartData.customer.phone)
      : null;

    if (formattedPhone) {
      const customerData = {
        ...cartData.customer,
        phone: formattedPhone,
        lastAbandonedAt: FieldValue.serverTimestamp(),
        abandonedCartIds: FieldValue.arrayUnion(payload.id),
        address: {
          street:
            cartData.shipping_address.street ||
            cartData.billing_address.street ||
            "",
          city:
            cartData.shipping_address.city ||
            cartData.billing_address.city ||
            "",
          postalCode:
            cartData.shipping_address.postalCode ||
            cartData.billing_address.postalCode ||
            "",
        },
        totalAbandoned: FieldValue.increment(1),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      await settingsRef
        .collection("abandoned_customers")
        .doc(formattedPhone)
        .set(customerData, { merge: true });
    }

    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("🔥 Error processing abandoned cart:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
