import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log("🔔 Webhook Received:");
  console.log("Shop Domain:", shop);
  console.log("Topic:", topic);

  const payload = await request.json();
  console.log("Payload:", payload);

  // מחיקת הסשנים מה-DB במקרה של uninstall
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response("ok");
};
