import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";

const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET!;

export const action: ActionFunction = async ({ request }) => {
  const rawBody = await request.text();
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const topic = request.headers.get("X-Shopify-Topic") || "";

  // אימות HMAC
  const hash = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  if (hash !== hmac) return new Response("Unauthorized", { status: 401 });

  const payload = JSON.parse(rawBody);

  switch (topic) {
    case "customers/data_request":
      // כאן תשלח או תחזיר את הנתונים שהלקוח ביקש
      console.log("📥 customers/data_request:", payload);
      break;
    case "customers/redact":
      // כאן תמחק את המידע שהלקוחות ביקשו למחק
      console.log("🗑️ customers/redact:", payload);
      break;
    case "shop/redact":
      // כאן תמחק את כל המידע הקשור לחנות
      console.log("🗑️ shop/redact:", payload);
      break;
    default:
      console.warn("Unhandled topic:", topic);
  }

  return json({}, { status: 200 });
};
