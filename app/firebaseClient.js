// app/firebaseClient.js

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCIEa0uRp4lk8JeZ3Fcy3qJP1OkcXO17lw",
  authDomain: "wixapp-8efb6.firebaseapp.com",
  projectId: "wixapp-8efb6",
  storageBucket: "wixapp-8efb6.firebasestorage.app",
  messagingSenderId: "292423528551",
  appId: "1:292423528551:web:d66e90c8cd687c3e97e4c2",
  measurementId: "G-G8RC7D2ZCV",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);