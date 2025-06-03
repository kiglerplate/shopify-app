import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`📦 Webhook Topic: ${topic}`);
  console.log(`🏬 Shop: ${shop}`);
  console.log("📨 Payload:", JSON.stringify(payload, null, 2));

  return new Response("Webhook received", { status: 200 });
};
