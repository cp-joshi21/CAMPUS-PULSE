# CampusPulse — Firebase Infrastructure & Setup Guide
**Author:** IDE-A (Infrastructure Lead) / Coordinated with IDE-B (Lead Architect)  
**Firebase Project ID:** `campus-pulse-291af`  
**Region:** `asia-south1` (Mumbai)  
**Plan:** Firebase Spark (100% Free tier, Zero Billing / No Blaze upgrade)  
**Auth Domain:** `campus-pulse-291af.firebaseapp.com`  

---

## 1. Verified Firebase Project Identity
- **Project Name:** CampusPulse
- **Project ID:** `campus-pulse-291af`
- **Billing Plan:** Spark (No-Cost $0/month) — do not upgrade to Blaze
- **Default Database ID:** `(default)`
- **Cloud Firestore Location:** `asia-south1` (Mumbai)

---

## 2. Cloud Firestore Database Setup & Canonical Collections
Cloud Firestore contains three core domains:
1. `events`: Public campus events, announcements, workshops, and seminars.
   - Status: Enforced server-side via `netlify/functions/campus-ai.mjs`.
2. `users`: Student profile records and session metadata.
3. `user_tasks`: Private personal academic tasks and deadline reminders.
   - Canonical name: `user_tasks` (implemented in backend functions and verified across all test suites).

---

## 3. Firebase Authentication Setup
1. **Google Sign-In Provider:** Enabled in Firebase Console.
2. **Authorized Domains:**
   - Pre-configured & Verified: `localhost`, `127.0.0.1`
   - Post-Site Creation Requirement: Add the exact production Netlify domain (e.g. `campuspulse-preview.netlify.app`) immediately after site creation in Firebase Console > Authentication > Settings > Authorized domains.

---

## 4. Web App Credentials for Frontend Client
Registered Web App: `CampusPulse Web`

Environment variables consumed by frontend Vite build (`src/js/config.js`):
```env
VITE_FIREBASE_API_KEY=AIzaSy...[REDACTED]
VITE_FIREBASE_AUTH_DOMAIN=campus-pulse-291af.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=campus-pulse-291af
VITE_FIREBASE_STORAGE_BUCKET=campus-pulse-291af.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=[REDACTED]
VITE_FIREBASE_APP_ID=1:...:web:[REDACTED]
```

---

## 5. Service Account Generation & Backend Credentials
The backend Netlify Functions use the Firebase Admin SDK to perform administrative tasks, sanitize input, and verify tokens. Admin SDK bypasses client Firestore rules, so authorization checks are strictly enforced in `netlify/functions/campus-ai.mjs`.

### Secure Key Generation Procedure:
1. Open **Firebase Console > Project Settings > Service accounts**.
2. Select **Firebase Admin SDK** (Node.js).
3. Click **Generate new private key** and download the JSON key.
4. Keep the JSON file outside the git repository (protected by `.gitignore`).
5. Map credentials into the Netlify Admin Dashboard (Site Settings > Environment Variables):
   - `FIREBASE_PROJECT_ID`: `campus-pulse-291af`
   - `FIREBASE_CLIENT_EMAIL`: `firebase-adminsdk-xxxxx@campus-pulse-291af.iam.gserviceaccount.com`
   - `FIREBASE_PRIVATE_KEY`: Complete private key including `-----BEGIN PRIVATE KEY-----` and `\n` linebreaks.
6. **NEVER COMMIT OR STORE THIS JSON FILE IN GIT.**

---

## 6. Environment Variables Handoff Checklist for IDE-B

### Frontend Client (`.env` or local dev)
```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=campus-pulse-291af.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=campus-pulse-291af
VITE_FIREBASE_STORAGE_BUCKET=campus-pulse-291af.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=1:...:web:...
```

### Backend Serverless Functions (Netlify UI Environment Variables)
```env
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-2.5-flash
FIREBASE_PROJECT_ID=campus-pulse-291af
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@campus-pulse-291af.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
