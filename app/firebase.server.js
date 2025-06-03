// app/firebase.server.ts
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = {
  type: "service_account",
  project_id: "wixapp-8efb6",
  private_key_id: "1f6705efa2695e781152f121cea5a35d0a42a79b",
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") || "",
  client_email: "firebase-adminsdk-fbsvc@wixapp-8efb6.iam.gserviceaccount.com",
  client_id: "117816969067423096783",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url:
    "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40wixapp-8efb6.iam.gserviceaccount.com",
  universe_domain: "googleapis.com",
};

// ודא שאין כפילויות אתחול אם הקובץ רץ פעמיים
const app = getApps().length === 0 ? initializeApp({ credential: cert(serviceAccount) }) : undefined;

export const adminAuth = getAuth();
export const firestore = getFirestore();

