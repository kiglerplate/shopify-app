import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { firestore } from "../firebase.server"; // ודא שיש לך את הקובץ כמו שהראיתי קודם

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log("🔔 Webhook Received:");
  console.log("Shop Domain:", shop);
  console.log("Topic:", topic);

  const payload = await request.json();
  console.log("Payload:", payload);

  // ✅ שמירה ל־Firebase תחת collection "uninstalls"
  try {
    await firestore.collection("uninstalls").doc(shop).set({
      shop,
      topic,
      receivedAt: new Date().toISOString(),
      payload,
    });
    console.log("✅ Saved to Firestore");
  } catch (error) {
    console.error("❌ Failed to save to Firestore:", error);
  }

  // 🧹 מחיקת session מה־DB
  if (session) {
    try {
      await db.session.deleteMany({ where: { shop } });
      console.log("🗑️ Session deleted");
    } catch (err) {
      console.error("❌ Failed to delete session:", err);
    }
  }

  return new Response("ok");
};
