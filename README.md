# ARDTIG STORES

Static HTML/CSS/JavaScript storefront with a Flask API, Firebase Authentication and Firestore, Cloudinary image uploads, and a service worker. The entry page is `index.html` in the repository root.

## Configure Firebase

1. Create or select the Firebase project `ardtig-stores` and create a Firestore database.
2. Enable Google as a sign-in provider in Firebase Authentication. Add `localhost`, `127.0.0.1`, and the deployed Vercel domain to the authorized domains list. The app uses `<project-id>.firebaseapp.com` as its auth domain; custom auth domains also need their `/__/auth/handler` URI registered in the Google OAuth client.
3. Add the Firebase Web API key to `.env` as `FIREBASE_API_KEY`. The current workspace `.env` has the Admin SDK values but does not include this web key. The `/api/config` endpoint returns only the public web configuration; never expose `FIREBASE_PRIVATE_KEY` or `CLOUDINARY_API_SECRET` in browser code.
4. Deploy Firestore rules with `firebase deploy --only firestore:rules`. The source is `firestore.rules.txt`, configured in `firebase.json`.
5. After creating a store profile, manually set `users/{uid}.role` to `admin` for each trusted administrator.

## Configure Cloudinary and Vercel

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and all Firebase variables from `.env.example` in the Vercel project's Environment Variables. Vercel does not read the local `.env` file. `APP_ORIGIN` should be set to the deployed origin.

Install the Python dependencies from `requirements.txt`, then run the project with `vercel dev` so `/api/*` requests reach the Flask function. Deploy the project to Vercel after setting its environment variables. Do not deploy or share `.env`.

## Local limitations

The current development machine does not have Python or Java on `PATH`. The static storefront preview can run without them, but Flask endpoints and Firestore Emulator rule compilation require those runtimes. Firebase Auth and Firestore also require valid Firebase web configuration and a configured project.

## Data security

Public listing documents never contain login credentials. Admin submissions store credentials in `account_secrets`; after an administrator approves a purchase, a user-specific approved purchase record authorizes access to that purchaser's secret document. Payment submissions go through the authenticated API, which verifies the listing's current availability and exact price before notifying administrators.
# ARDTIG-STORES-INNIT
# ARDTIG-STORES-INNIT
