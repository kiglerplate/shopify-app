// app/routes/webhooks/carts.create.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // authenticate.webhook יבדוק את ה-HMAC ויזרוק אם לא תקין
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log("✅ Webhook Received:", topic);
    console.log("🛒 Shop:", shop);
    console.log("📦 Payload:", payload);

    return json({}, { status: 200 });
  } catch (error) {
    console.warn("❌ carts/create — webhook verification failed", error);
    return new Response("Unauthorized", { status: 401 });
  }
};
