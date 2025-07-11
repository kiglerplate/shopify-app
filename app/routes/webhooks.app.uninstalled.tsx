// app/routes/webhooks/carts.create.tsx
import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

export const action: ActionFunction = async ({ request }) => {
  // 1. קבלת הגוף הגולמי
  const rawBody = await request.clone().text();

  // 2. קריאת ה־HMAC מה-header
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  // 3. חישוב ה־HMAC שלנו
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  // 4. השוואה בטיחותית עם בדיקת אורך כדי שלא יזרוק
  const shopifyBuf = Buffer.from(shopifyHmac, 'base64');
  const computedBuf = Buffer.from(computedHmac, 'base64');
  let valid = false;

  if (shopifyBuf.length === computedBuf.length) {
    try {
      valid = crypto.timingSafeEqual(computedBuf, shopifyBuf);
    } catch (err) {
      valid = false;
    }
  }

  if (!valid) {
    console.warn("❌ carts/create — invalid HMAC", { computedHmac, shopifyHmac });
    return new Response("Unauthorized", { status: 401 });
  }

  // 5. פרסור וממש את הלוגיקה
  const topic = request.headers.get("X-Shopify-Topic");
  const shop = request.headers.get("X-Shopify-Shop-Domain");
  const payload = JSON.parse(rawBody);

  console.log("✅ carts/create webhook:", { shop, topic, payload });

  return json({}, { status: 200 });
};
