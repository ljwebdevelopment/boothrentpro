import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';

// Replace with your own project values from Firebase Console > Project Settings > General
const firebaseConfig = {
  apiKey: "AIzaSyA-lC9Lgvm7IaycERInoU9MSg9fc1j4yHM",
  authDomain: "boothrent-pro.firebaseapp.com",
  projectId: "boothrent-pro",
  storageBucket: "boothrent-pro.firebasestorage.app",
  messagingSenderId: "761610901694",
  appId: "1:761610901694:web:0b0350219c872d4055e6ef",
  measurementId: "G-5CM96PJ5S3"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
