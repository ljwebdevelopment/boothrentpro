# BoothRent Pro (Plain HTML/CSS/JS + Firebase)

This project contains:
- `index.html`: Owner/admin dashboard
- `staff.html`: Staff portal (read-only)
- `app.js` and `staff.js`: Browser logic (Firebase v10 modular SDK from CDN)
- `functions/`: Firebase Cloud Functions for invite claim and server-side email enqueueing
- `firestore.rules`: Security rules

## Setup Guide (step-by-step, beginner-friendly)

1. **Create Firebase project**
   1. Go to https://console.firebase.google.com
   2. Click **Create a project** and finish the wizard.

2. **Create Firestore database**
   1. In Firebase Console left menu, click **Firestore Database**.
   2. Click **Create database**.
   3. Start in production mode.
   4. Pick your region.

3. **Enable Authentication providers**
   1. Go to **Authentication** > **Sign-in method**.
   2. Enable **Email/Password**.
   3. In Email/Password, also enable **Email link (passwordless sign-in)**.
   4. Why both? Firebase Email Link is part of Email/Password provider settings.

4. **Create owner user**
   1. In **Authentication** > **Users** click **Add user**.
   2. Add owner email + password.
   3. Copy the owner's UID from the Users table.

5. **Create initial Firestore documents**
   1. In Firestore, create collection `shops`.
   2. Add document with ID like `shop_001`.
   3. Add fields:
      - `businessName` (string)
      - `businessEmail` (string)
      - `businessPhone` (string)
      - `address` (string)
      - `ownerUid` (string)
      - `weekStartsOn` (string: `Monday` or `Sunday`)
      - `createdAt` (timestamp)
      - `nextReceiptSeq` (number, start at `1`)
      - `staffPortalBaseUrl` (string; your GitHub Pages staff URL)
   4. Create collection `users`.
   5. Add document with ID exactly equal to owner UID.
   6. Add fields:
      - `role = "owner"`
      - `shopId = "shop_001"`
      - `employeeId = null`
      - `email = owner email`
      - `createdAt = timestamp`

6. **Install Trigger Email extension (recommended email path)**
   1. In Firebase Console go to **Extensions**.
   2. Install **Trigger Email (firestore-send-email)**.
   3. Choose collection path `mail`.
   4. Provide SMTP settings (from SendGrid/Mailgun/other SMTP provider).
   5. After install, when docs are written to `/mail`, extension sends email.

   Alternative (not implemented here): custom SendGrid API calls from Cloud Functions.

7. **Cloud Functions setup (requires terminal)**

   What is a terminal? A terminal is a text window where you run commands.

   **Windows open terminal options**:
   - Start menu -> search **PowerShell** (easy default)
   - or install/use **Windows Terminal** from Microsoft Store

   Then run these commands inside your project folder:

   ```bash
   cd path\to\boothrentpro
   npm --version
   ```

   If `npm` missing, install Node.js LTS from https://nodejs.org first.

   Install Firebase CLI globally:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add
   ```

   Deploy functions:

   ```bash
   cd functions
   npm install
   cd ..
   firebase deploy --only functions
   ```

   View logs:
   ```bash
   firebase functions:log
   ```

8. **Add Firebase frontend config**
   1. Open `firebase-config.js`.
   2. Replace all `REPLACE_ME` values with your Firebase project values.
   3. Firebase config values are in Firebase Console -> Project Settings -> General -> Your apps.

9. **Deploy frontend to GitHub Pages**
   - No build tools needed. Upload all root files (`index.html`, `staff.html`, JS, CSS) to repo branch used by Pages.
   - In GitHub repo -> Settings -> Pages:
     - Source: Deploy from branch
     - Branch: `main` (or your chosen branch), folder `/root`

10. **Final test checklist**
   - Owner logs in at `index.html`.
   - Owner creates employee.
   - Owner clicks Invite staff login.
   - Staff receives invite and opens `staff.html?invite=...` link.
   - Staff signs in with email link and invite is claimed.
   - Owner marks paid twice ($50, then $100).
   - Receipt email is sent.
   - Staff sees updated status + receipts in portal.

## Debug locations

- Browser errors: press `F12` -> Console tab.
- Firestore rules: Firestore -> Rules -> Rules Playground (simulator).
- Functions logs: `firebase functions:log` or Console -> Functions -> Logs.
- Trigger Email extension logs: Console -> Extensions -> Trigger Email -> Logs.
