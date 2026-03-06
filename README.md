# BSides Perth Conference Scheduler

A web-based conference scheduling app with a **private planning page** for organisers and a **public schedule page** for attendees. Powered by Firebase Firestore for real-time collaboration — no server required.

---

## Quick Start (10 steps)

### Step 1 — Create a Firebase project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com) and sign in with Google.
2. Click **"Add project"**, give it a name like `bsides-perth-2026`, click through the wizard.

### Step 2 — Enable Firestore

1. In your new project, click **Build** in the left sidebar → **Firestore Database**.
2. Click **"Create database"**.
3. Choose **"Start in test mode"** (allows reading and writing without login — suitable for this app).
4. Pick a region close to Australia (e.g. `australia-southeast1`) and click **Done**.

### Step 3 — Register a Web App

1. Click the **gear icon** (Project Settings) at the top of the left sidebar.
2. Scroll down to **"Your apps"** → click the **`</>`** (Web) icon.
3. Give it a nickname (e.g. `BSides Perth Web`), click **Register app**.
4. Firebase shows you a `firebaseConfig` object. **Keep this page open** — you'll need it in Step 4.

### Step 4 — Edit the config file

Open `js/firebase-config.js` in a text editor and replace each `YOUR_...` placeholder with the values from the Firebase console:

```js
export const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "bsides-perth-2026.firebaseapp.com",
  projectId:         "bsides-perth-2026",
  storageBucket:     "bsides-perth-2026.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abcdef"
};
```

Also change `ADMIN_PIN` to something private — only your organising team needs to know it:

```js
export const ADMIN_PIN = "your-secret-pin";
```

### Step 5 — Install the Firebase command-line tool

Open a terminal (Command Prompt / PowerShell on Windows, Terminal on Mac) and run:

```
npm install -g firebase-tools
```

> If you don't have Node.js / npm installed, download it from [https://nodejs.org](https://nodejs.org) first (LTS version).

### Step 6 — Log in to Firebase

```
firebase login
```

A browser window will open — sign in with the same Google account you used to create the project.

### Step 7 — Update the project ID

Open `.firebaserc` and replace `YOUR_FIREBASE_PROJECT_ID` with your actual project ID (the `projectId` value from Step 4):

```json
{
  "projects": {
    "default": "bsides-perth-2026"
  }
}
```

### Step 8 — Deploy

In a terminal, navigate to the project folder and run:

```
firebase deploy --only hosting
```

Firebase will upload all files and give you a URL like:
```
https://bsides-perth-2026.web.app
```

### Step 9 — Share the URLs

| Page | URL | Who gets it? |
|------|-----|-------------|
| Public schedule | `https://YOUR-PROJECT.web.app/` | Everyone |
| Admin/planning  | `https://YOUR-PROJECT.web.app/admin.html` | Organisers only (keep private) |

### Step 10 — To update after making changes

Edit files locally, then run:
```
firebase deploy --only hosting
```

---

## Using the Admin Page

1. Navigate to `/admin.html` and enter the PIN you set in `firebase-config.js`.
2. Enter your name when prompted (so co-organisers can see who's editing).
3. **Step 1 — Event Setup**: Fill in the conference name, year, number of days, dates, and times. Click **Save & Continue**.
4. **Step 2 — Sessions & Schedule**:
   - Click **+ Add Session** to enter talks, panels, workshops, etc.
   - Click **⚡ Auto-Schedule** to automatically arrange sessions into a schedule.
   - Drag and drop slots to reorder them manually.
   - Use the block buttons at the bottom of each day column to add Doors Open, Registration, Lunch, etc.
5. Click **🔒 Lock Schedule** when you're done to prevent accidental changes.
6. Use **⬇ Export CSV** to download a spreadsheet, or **🖨 Print / PDF** to save a printable version.

### Real-time collaboration

All changes save automatically and appear in real-time for anyone else with the admin page open. You can see who last made a change in the top bar.

---

## File Structure

```
BSidesPerthAgenda/
├── index.html              ← Public schedule page
├── admin.html              ← Admin/planning page
├── firebase.json           ← Firebase Hosting config
├── .firebaserc             ← Your Firebase project ID (edit this)
├── README.md               ← This file
├── css/
│   ├── styles.css          ← Shared styles
│   ├── public.css          ← Public page styles
│   └── admin.css           ← Admin page styles
└── js/
    ├── firebase-config.js  ← YOUR FIREBASE CREDENTIALS GO HERE
    ├── firestore.js        ← Shared data layer
    ├── admin/              ← Admin page JS modules
    └── public/             ← Public page JS modules
```

---

## Security Notes

- The admin page is protected by a PIN, not a full login system. This is suitable for a low-stakes conference scheduling tool.
- **Keep the `admin.html` URL private** — only share it with your organising team.
- The `ADMIN_PIN` in `firebase-config.js` is visible in the browser's source code to anyone who knows the admin URL. This is acceptable for this use case.
- Firestore is in "test mode" (open read/write). This means anyone who finds your Firestore project ID could potentially write to it. For additional security, you can update the Firestore security rules in the Firebase console after the conference.
- **Do not commit `js/firebase-config.js` to a public GitHub repository** if you're concerned about your Firebase credentials being exposed.

---

## Troubleshooting

**"No schedule yet" on the public page**
→ Make sure you've completed Event Setup and run Auto-Schedule on the admin page.

**"Incorrect PIN" on the admin page**
→ Check the `ADMIN_PIN` value in `js/firebase-config.js`. PINs are case-sensitive.

**Firebase deploy fails**
→ Make sure you've run `firebase login` and that the project ID in `.firebaserc` matches your Firebase project.

**Sessions not saving / real-time not working**
→ Check the browser console (F12) for errors. The most common cause is incorrect values in `firebase-config.js`.

**Firebase version**
→ This app uses Firebase SDK version `10.14.1`. If you need to update it, change the version number in `index.html`, `admin.html`, and `js/firestore.js`.

---

## Updating the Firebase SDK version

The Firebase SDK version is set in three places. Find `10.14.1` and replace with the new version:

1. `index.html` — two import URLs in the `<script type="module">` at the bottom
2. `admin.html` — two import URLs in the `<script type="module">` at the bottom
3. `js/firestore.js` — all import URLs at the top

Check [https://firebase.google.com/docs/web/learn-more#cdn-urls](https://firebase.google.com/docs/web/learn-more#cdn-urls) for available versions.
