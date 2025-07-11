// app/routes/webhooks/carts.create.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Shopify’s webhook verifier ― יזרוק אם ה־HMAC לא תואם
    const { shop, topic, payload } = await authenticate.webhook(request);

    console.log("✅ Webhook Received:", topic);
    console.log("🛒 Shop:", shop);
    console.log("📦 Payload:", payload);

    return json({}, { status: 200 });
  } catch (error) {
    console.warn("❌ Webhook verification failed:", error);
    // 返回 401 כדי שה־App Store automated check יזהה את זה
    return new Response("Unauthorized", { status: 401 });
  }
};
