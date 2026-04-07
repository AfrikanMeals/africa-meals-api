# Firebase Storage – image and file storage

The API uses **Firebase Storage** via the **Firebase Admin SDK** (service account) for uploading and serving images and files (e.g. profile pictures, product images). The `MediasService` is used by Auth (user profile image), Store (store profile image, products), and Announcements.

Using the Admin SDK avoids the `storage/unauthorized` (403) error: uploads are done with the service account and are not subject to client Storage security rules.

## 1. Create a Firebase project (if needed)

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Create a project or select an existing one.
3. Enable **Storage**: **Build → Storage → Get started** (choose production or test mode; you can tighten rules later).

## 2. Get a service account key

1. In Firebase Console: **Project settings** (gear) → **Service accounts**.
2. Click **Generate new private key** and save the JSON file (e.g. `serviceAccountKey.json`). Keep it secret and never commit it to the repo.

## 3. Configure the API

In your `.env` (see `.env.example`), set:

- **`AM_FIREBASE_PROJECT_ID`** – Firebase / GCP project ID.  
  (Do **not** use `FIREBASE_PROJECT_ID` — that prefix is reserved when using Firebase Cloud Functions deploy.)
- **`AM_FIREBASE_STORAGE_BUCKET`** – Storage bucket (e.g. `your-project-id.appspot.com` or `your-project-id.firebasestorage.app`).

Then **choose one** of these for the service account credential:

**Option A – File path (recommended for local/prod)**

```env
GOOGLE_APPLICATION_CREDENTIALS=accounts.json
```

The path is **relative to the project root** (directory from which you start the API). You can also use an absolute path.

**Option B – JSON in env (e.g. Docker / CI)**

```env
AM_FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...",...}
```

Paste the **entire** content of the service account JSON as a single line. Useful when you cannot mount a file.

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

Only your API (with the service account) can write; clients can only read (e.g. via the download URLs returned by the API).

## 5. How the API uses Storage

- **Upload**: `MediasService.upload(file, user, basePath)` uploads to `{basePath}/{uuid}.{ext}` and returns the download URL (via `getDownloadURL`).
- **Delete**: `MediasService.delete(pathOrUrl)` deletes by path or by full Firebase Storage URL (path is extracted automatically).
- **Paths**: Profile images use paths like `users/{userId}/profile/...` and `stores/{storeId}/profile/...`.

The app initializes the Firebase Admin app in `SharedModule` and injects it (and the bucket name) into `MediasService`.
