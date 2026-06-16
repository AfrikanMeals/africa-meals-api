# Firebase Storage – image and file storage

The API uses **Firebase Storage** via the **Firebase Admin SDK** (service account) for uploading and serving images and files (e.g. profile pictures, product images). The `MediasService` is used by Auth (user profile image), Store (store profile image, products), and Announcements.

Using the Admin SDK avoids the `storage/unauthorized` (403) error: uploads are done with the service account and are not subject to client Storage security rules.

## 1. Create a Firebase project (if needed)

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Create a project or select an existing one.
3. Enable **Storage**: **Build → Storage → Get started** (choose production or test mode; you can tighten rules later).

## 2. Get a service account key

1. In Firebase Console: **Project settings** (gear) → **Service accounts**.
2. Click **Generate new private key** and save the JSON file **outside the repo** (e.g. `~/secrets/wise-eat-firebase.json`). Keep it secret and never commit it to Git.
3. Use `accounts.json.example` at the repo root as a structural reference only.

## 3. Configure the API

In your `.env` (see `.env.example`), set:

- **`AM_FIREBASE_PROJECT_ID`** – Firebase / GCP project ID.  
  (Do **not** use `FIREBASE_PROJECT_ID` — that prefix is reserved when using Firebase Cloud Functions deploy.)
- **`AM_FIREBASE_STORAGE_BUCKET`** – Storage bucket (e.g. `your-project-id.appspot.com` or `your-project-id.firebasestorage.app`).

Then **choose one** of these for the service account credential:

**Option A – JSON in env (recommended for prod / CI / Secret Manager)**

```env
AM_FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...",...}
```

Paste the **entire** content of the service account JSON as a single line.

**Option B – Discrete env vars (multi-secret stores)**

```env
AM_FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL=firebase-adminsdk-...@your-project.iam.gserviceaccount.com
AM_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

**Option C – File path (local dev only; file must stay outside the repo)**

```env
AM_FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/firebase-service-account.json
```

## 4. Storage security rules

With the Admin SDK, the backend uses the service account and **bypasses** client Storage rules for upload/delete. You can keep strict rules for client access, for example:

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

Only your API (with the service account) can write; clients read via public GCS URLs (`https://storage.googleapis.com/{bucket}/…`) once the bucket allows public access (`allUsers: Storage Object Viewer` and public access prevention disabled), or via Firebase download URLs when using the Firebase engine.

## 5. How the API uses Storage

- **Upload**: `MediasService.upload(file, user, basePath)` uploads to `{basePath}/{uuid}.{ext}` and returns the download URL (via `getDownloadURL`).
- **Delete**: `MediasService.delete(pathOrUrl)` deletes by path or by full Firebase Storage URL (path is extracted automatically).
- **Paths**: Profile images use paths like `users/{userId}/profile/...` and `stores/{storeId}/profile/...`.

The app initializes the Firebase Admin app in `SharedModule` and injects it (and the bucket name) into `MediasService`.

## 6. Key rotation

If a service account JSON was ever committed to Git, follow [FIREBASE_KEY_ROTATION.md](./FIREBASE_KEY_ROTATION.md) immediately.
