// app/routes/webhooks/compliance.tsx
import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

export const action: ActionFunction = async ({ request }) => {
  // 1. קבלת הגוף הגולמי
  const rawBody = await request.clone().text();

  // 2. השליפה של ה־HMAC מה־header
  const shopifyHmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  // 3. חישוב HMAC מקומי
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
    console.warn("❌ compliance webhook — invalid HMAC", { computedHmac, shopifyHmac });
    return new Response("Unauthorized", { status: 401 });
  }

  // 5. פרסור הטופיק וה־payload
  const topic = request.headers.get("X-Shopify-Topic")!;
  const payload = JSON.parse(rawBody);

  switch (topic) {
    case "customers/data_request":
      console.log("📥 customers/data_request payload:", payload);
      // TODO: שלח או הצג את נתוני הלקוח
      break;
    case "customers/redact":
      console.log("🗑️ customers/redact payload:", payload);
      // TODO: מחק את כל הלקוחות לפי ID
      break;
    case "shop/redact":
      console.log("🗑️ shop/redact payload:", payload);
      // TODO: מחק את כל הנתונים של החנות
      break;
    default:
      console.warn("Unhandled compliance topic:", topic);
  }

  return json({}, { status: 200 });
};
