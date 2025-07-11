// app/routes/webhooks/carts.create.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

export const action = async ({ request }: ActionFunctionArgs) => {
  // 1. קבלת הגוף הגולמי לפני כל parsing
  const rawBody = await request.clone().text();

  // 2. הוצאת ה־HMAC שה-Shopify שלח
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  // 3. חישוב HMAC על פי הסוד
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  // 4. השוואה בטיחותית
  const valid = crypto.timingSafeEqual(
    Buffer.from(computedHmac),
    Buffer.from(shopifyHmac)
  );
  if (!valid) {
    console.warn("❌ carts/create — invalid HMAC", { computedHmac, shopifyHmac });
    return new Response("Unauthorized", { status: 401 });
  }

  // 5. עכשיו אפשר לשלוף את שאר ה־headers וה־payload
  const topic = request.headers.get("X-Shopify-Topic")!;
  const shop = request.headers.get("X-Shopify-Shop-Domain")!;
  const payload = JSON.parse(rawBody);

  console.log("✅ carts/create webhook:", { shop, topic, payload });

  return json({}, { status: 200 });
};
