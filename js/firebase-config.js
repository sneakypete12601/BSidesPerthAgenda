// =============================================================================
// FIREBASE CONFIGURATION
// =============================================================================
// SETUP INSTRUCTIONS (do this once before deploying):
//
// 1. Go to https://console.firebase.google.com and sign in with Google.
// 2. Click "Add project", give it a name (e.g. "bsides-perth-2026"), click through.
// 3. In your new project, click "Build" in the left sidebar → "Firestore Database".
//    Click "Create database", choose "Start in test mode", pick a region, click Done.
// 4. Click the gear icon (Project Settings) → scroll to "Your apps" → click the
//    Web icon ( </> ). Give it a nickname and click "Register app".
// 5. Firebase will show you a "firebaseConfig" object. Copy the values into the
//    fields below, replacing each "YOUR_..." placeholder.
// 6. Change ADMIN_PIN to something private (any string you like).
// 7. Deploy following the instructions in README.md.
// =============================================================================

export const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// The Firestore document ID for this conference. You generally never need to
// change this unless you are running multiple separate conferences in one project.
export const CONFERENCE_ID = "bsides-perth";

// PIN required to access the admin/planning page.
// Change this to something only your organising team knows.
// Note: this is security-by-obscurity — suitable for a low-stakes conference
// schedule tool, but not for sensitive data.
export const ADMIN_PIN = "bsides2026";
