// app/firebase.server.ts
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const serviceAccount = {
  type: "service_account",
  project_id: "wixapp-8efb6",
  private_key_id: "1f6705efa2695e781152f121cea5a35d0a42a79b",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD02YrcJwRoNhoW\nL1lkMb87CO8bDFPBq0QkwzWP1KqwS+QHRuqu24RP2iMMsFkgcaw+3EnViKYKKsVD\nV8mHZ2zeX9ySACnUhfEmIfM3auNkp55DpSkigEfNJm6iFU3RuI7aeKXSNtbGIHyP\nCQeFXcy211kcVk4iOrAmuHnvLVGCord7xJzNnvGY4/3m7ygI+MRVsNDIWsD9Ltkv\nIIx3JU4ifX3fCeHUnr/a0/QlyBAwTajdjlKeQJncDoq4zv7R/F7eki7kHQzQdCL3\n+s/r3kLlfY2h4J5zscn7Bhttk8upWRAg7XwsG3QTO6D6pkVkMGXrIh+W3CYKSqda\nWZdcq/2nAgMBAAECggEACWrXP8HIa5xZGIKttNWCU2pJOAhwrZbsF2CNY4DR0oIO\nEobpvoahlNNWXHCT8lQs7yYDOPv5LD7vjg2G/3bnkGNY1SITJHdvtQBtSF5gwfL9\n0AA+5XLQUCsAP6pYxI44AF3PkuxFCnh0Ef746RTt1hfQ95liMUgslPCsz+7gSbPr\n3ia7ChL2WNqi3Sv8srv+SzbPRI3S8E3VejV6N7tXAZ5RfYOkkix5xAO/cLJH0ZRx\nuvJzl6QtahawhBfeyKEhsdZvj8ZQ1/m9Ssc0LJ4VUokVIv2NoZrPLANr6YF7geWJ\nPe8DQZmK3vKIoGjo16mmWbrrboweLenxqwXBpilGwQKBgQD/O8h7FCdfeMk1Dlj0\n2alIYkc0+AHaaqeHPCj/xpXhZaPTr7+5+kFL9istuif2IaeOYbiPq0e2FNnrjPmj\ntls2C+0eb0HSTez0Q9HV/NPUTv0KtYsGXZGLwHRHQ/0fNNe+mNGT22J/sogXdm4V\nVJtFQ2LItk9e1Q/9czYbpKEjcQKBgQD1lcbLC6nEP0kOmoxlSEq1PmMx/BxJaVod\nM3ZjmqsKvHHkkKwvyxenKk+6ZCNmpeElckUVrXXnrZoNlugW4FOrd24lsfDDp5J/\nBPOpcsW3LLPd2KEXh1rduwRlgLigmgtTNeMMV0bSEXoY5EZqGGbzOBrlhapK07f2\nyZvu9up2lwKBgHw6Atg09Pz48yXJt+5kyooam4HifDRs2OFvnJzxcR3ltJlh3zWL\n4qAwTs/Q3YZk1wLr+UKkISE0gOSvFwphxX9GysCXcjgECaLSJ525kvixAWRm/CW7\nAQ4+O9o780VvGNsB0m/exdBVevvAftAPAAv0Qm5inbsQhNnda6aEuJFhAoGBAJey\nduNBRxJkDRqqOILvjsY5zUg49LgcDX/wI/cOuQyerrOC8flruCaYKjt2U6+6U0Kw\nPSBQz33WbExspNxMoSJPWYiLS69vuTwgsOpAbQTi5g/pGkjQYT6JoQOZ6XG69bfm\nl2MuHh7wkL0DdMNgY2dlhqe0UyZ5dS9KBbosZ1PtAoGARswp4OeygXxINkJxwNYo\nsfmBBXqqOzxBJKRGfedhkiA2SoWt/Nob9EX6pj8JKiAqeERKoWynLHsJSKKXQ9T9\nbnICkKAPrnStfHW+EvinFxE/sGdSMK1an5OwX2aXswdLKleZjOC6YsjArpN1/4C3\nJV2Aa05H/0dVbuiBeoYj8Rc=\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk-fbsvc@wixapp-8efb6.iam.gserviceaccount.com",
  client_id: "117816969067423096783",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url:
    "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40wixapp-8efb6.iam.gserviceaccount.com",
  universe_domain: "googleapis.com",
};

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

// Firestore ו-Auth
export const db = getFirestore();
// (אם אתה צריך FieldValue.serverTimestamp)
export const FieldValue = FieldValue;
// Admin SDK (לקריאה אל admin.firestore.FieldValue אם תרצה)
export const admin = { auth: getAuth(), apps: getApps() };
