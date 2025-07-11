// app/routes/webhooks/carts.create.tsx
import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

export const action: ActionFunction = async ({ request }) => {
  // 1. מצמידים קלון כדי לקרוא את הטקסט הגולמי
  const reqClone = request.clone();
  const rawBody = await reqClone.text();

  // 2. מוציאים את ה-HMAC שה-Shopify שלח ב-header
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  // 3. מחשבים HMAC משלנו
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  // 4. משווים בצורה בטוחה
  const hmacMatches = crypto.timingSafeEqual(
    Buffer.from(computedHmac),
    Buffer.from(shopifyHmac)
  );
  if (!hmacMatches) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 5. אם עבר, אפשר לפרסר ולעשות לוגיקה
  const payload = JSON.parse(rawBody);
  console.log("✅ carts/create payload:", payload);

  return json({}, { status: 200 });
};
