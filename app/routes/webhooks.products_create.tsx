import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log("✅ Webhook Received:", topic);
  console.log("🛒 Shop:", shop);
  console.log("📦 Payload:", payload);

  return new Response("ok");
};
