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
  apiKey: "AIzaSyAVgmbi8IJcWDhC1fAno51hXD0vqPA-eZ0",
  authDomain: "boothrent-pro-e4176.firebaseapp.com",
  projectId: "boothrent-pro-e4176",
  storageBucket: "boothrent-pro-e4176.firebasestorage.app",
  messagingSenderId: "713153375362",
  appId: "1:713153375362:web:4da72895d574e0c67d189b",
  measurementId: "G-Z9LJC7EBGB"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Export helpers so the dashboard can stay clean and beginner-friendly.
export { serverTimestamp, Timestamp, runTransaction, increment };
