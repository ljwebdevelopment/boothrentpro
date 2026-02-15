import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  serverTimestamp,
  Timestamp,
  runTransaction,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Replace these placeholder values with your Firebase project's real keys.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Export helpers so the dashboard can stay clean and beginner-friendly.
export { serverTimestamp, Timestamp, runTransaction, increment };
