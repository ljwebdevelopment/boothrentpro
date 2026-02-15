# BoothRent Pro Firebase Setup (Beginner Guide)

This document explains exactly what you need to add so the app can connect to Firebase Firestore.

---

## 1) What this app uses from Firebase

This project is **frontend-only** and uses Firebase for:

- `renters` collection (main renter records)
- `ledger` collection (charges/payments/fees/credits)
- `messages` collection (reminders/receipts log)

It does **not** use Firebase Auth. Login is hardcoded in `js/login.js`.

---

## 2) Create a Firebase project

1. Go to: https://console.firebase.google.com/
2. Click **Create a project**.
3. Follow prompts and finish project creation.

---

## 3) Register a Web App in Firebase

1. Open your Firebase project.
2. Click the **gear icon** (Project settings).
3. In **Your apps**, click the **Web icon** (`</>`).
4. Give app a nickname (example: `boothrentpro-web`).
5. Click **Register app**.
6. Firebase will show a config object with keys like `apiKey`, `projectId`, etc.

---

## 4) Paste your Firebase config in this project

Open file:

- `js/firebase.js`

Replace placeholders in `firebaseConfig` with your real values:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

After replacement, save the file.

---

## 5) Enable Firestore Database

1. In Firebase Console, click **Build > Firestore Database**.
2. Click **Create database**.
3. Choose a location close to your users.
4. Start in **Test mode** while developing (you can tighten rules later).

---

## 6) Add Firestore security rules (recommended)

Because this app has hardcoded frontend login (not Firebase Auth), Firebase cannot identify users securely by itself.
For production, you should add stronger security (for example, Cloud Functions + custom auth).

For now, this is a simple starter rule set for development:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /renters/{docId} {
      allow read, write: if true;
    }
    match /ledger/{docId} {
      allow read, write: if true;
    }
    match /messages/{docId} {
      allow read, write: if true;
    }
  }
}
```

> Important: `if true` means anyone with your app can read/write data. Use this only for development/testing.

---

## 7) Create Firestore indexes (if prompted)

The dashboard uses realtime queries like ordering ledger by `createdAt`.
If Firestore asks for an index, click the auto-generated link from the error message and create it.

Most basic queries in this app work without custom composite indexes initially.

---

## 8) Data shape expected by the app

### `renters` document example

```json
{
  "displayName": "Alex Carter",
  "email": "alex@example.com",
  "phone": "",
  "station": "S-4",
  "photoUrl": "",
  "active": true,
  "rentPlan": {
    "cadence": "weekly",
    "amountCents": 25000,
    "dueDay": "Tuesday"
  },
  "balanceCents": 12000,
  "nextDueAt": "Firestore Timestamp",
  "statusOverride": null,
  "notes": "",
  "updatedAt": "serverTimestamp",
  "createdAt": "serverTimestamp"
}
```

### `ledger` document example

```json
{
  "renterId": "RENDER_DOC_ID",
  "type": "payment",
  "amountCents": 5000,
  "createdAt": "serverTimestamp",
  "effectiveAt": "Firestore Timestamp",
  "note": "Paid cash",
  "meta": { "method": "cash" }
}
```

### `messages` document example

```json
{
  "renterId": "RENTER_DOC_ID",
  "kind": "reminder",
  "toEmail": "alex@example.com",
  "subject": "Rent Reminder - BoothRent Pro",
  "body": "...",
  "createdAt": "serverTimestamp",
  "sentAt": null,
  "sentBy": "admin@example.com",
  "status": "draft"
}
```

---

## 9) How to check if Firebase is connected

1. Run the site.
2. Login.
3. Add a renter from dashboard.
4. Open Firebase Console > Firestore Database.
5. Confirm a new document appears in `renters`.

If it appears, your config and Firestore connection are working.

---

## 10) Common issues

### A) "Missing or insufficient permissions"
- Your Firestore rules are blocking reads/writes.
- Update rules in **Firestore > Rules**.

### B) "Firebase: Error (app/invalid-api-key)"
- One or more values in `firebaseConfig` are incorrect.
- Re-copy from Firebase project settings.

### C) Realtime list not updating
- Ensure Firestore is enabled.
- Ensure browser console has no errors.
- Ensure `onSnapshot` code remains in `js/dashboard.js`.

---

## 11) Deployment note for GitHub Pages

Use relative paths (already done in this repo) so routes work on project URLs like:

`https://yourname.github.io/boothrentpro/`

Do not change redirects to leading slash paths such as `/html/dashboard.html`.
