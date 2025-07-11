// app/routes/webhooks/carts.create.tsx
import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

export const action: ActionFunction = async ({ request }) => {
  // 1. קבלת הגוף הגולמי של הבקשה
  const rawBody = await request.clone().text();

  // 2. קריאת ה־HMAC ש-Shopify שלח ב־header
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  // 3. חישוב HMAC משלנו
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  // 4. השוואה בטיחותית בין החתימות
  const valid = crypto.timingSafeEqual(
    Buffer.from(computedHmac),
    Buffer.from(shopifyHmac)
  );
  if (!valid) {
    console.warn("❌ carts/create — invalid HMAC", { computedHmac, shopifyHmac });
    return new Response("Unauthorized", { status: 401 });
  }

  // 5. חילוץ shop, topic ו־payload
  const topic = request.headers.get("X-Shopify-Topic");
  const shop = request.headers.get("X-Shopify-Shop-Domain");
  const payload = JSON.parse(rawBody);

  console.log("✅ carts/create webhook:", { shop, topic, payload });

  return json({}, { status: 200 });
};
