// app/routes/webhooks/carts.create.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

export const action = async ({ request }: ActionFunctionArgs) => {
  // 1. קבלת הטקסט הגולמי (ה-body) לפני כל פרסור
  const rawBody = await request.clone().text();

  // 2. הוצאת ה-HMAC שה-Shopify שלח ב-header
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  // 3. חישוב HMAC משלנו
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  // 4. השוואה בטיחותית בין buffers
  const validHmac = crypto.timingSafeEqual(
    Buffer.from(computedHmac),
    Buffer.from(hmacHeader)
  );

  if (!validHmac) {
    console.warn("❌ carts/create — invalid HMAC", { computedHmac, hmacHeader });
    return new Response("Unauthorized", { status: 401 });
  }

  // 5. במידה ו-HMAC תקין, מפיקים את שאר המידע
  const topic = request.headers.get("X-Shopify-Topic");
  const shop = request.headers.get("X-Shopify-Shop-Domain");
  const payload = JSON.parse(rawBody);

  console.log("✅ carts/create webhook received", { shop, topic, payload });

  // 6. מחזירים 200 OK
  return json({}, { status: 200 });
};
