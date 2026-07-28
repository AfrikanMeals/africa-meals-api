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

Only your API (with the service account) can write. **Production** should not rely on anonymous GCS reads (`allUsers` + PAP off). Prefer:

1. **Media proxy** (Admin → Paramètres → Stockage → Proxy API) so clients load `https://{API}/medias/public/…` while the bucket stays private.
2. Or Firebase download URLs when using the Firebase engine (`getDownloadURL` token).

## 7. Production private bucket (PAP + no allUsers)

Hardening checklist for `GCS_BUCKET` (e.g. `wise-eat-store`):

1. Deploy API/admin with media proxy enabled when the upload pool includes **GCS**.
2. Env: `GCS_PUBLIC_READ=false`, `STORAGE_OBJECT_ACL=false` (no `makePublic` on upload).
3. Enforce Public Access Prevention:
   ```bash
   gcloud storage buckets update gs://$GCS_BUCKET --public-access-prevention
   ```
4. Remove public principals (`allUsers` / `allAuthenticatedUsers`) from bucket IAM.
5. Least privilege (bucket-scoped, not project Editor):
   - API service account → `roles/storage.objectAdmin` on the bucket
   - Backup SA → same (or objectCreator+Viewer), ideally limited to `mongodb/`
6. Optional but recommended for backups: object versioning
   ```bash
   gcloud storage buckets update gs://$GCS_BUCKET --versioning
   ```

Idempotent helper (dry-run by default):

```bash
cd africa-meals-infra
GCS_BUCKET=wise-eat-store ./scripts/harden-gcs-bucket.sh
APPLY=1 ENABLE_VERSIONING=1 ./scripts/harden-gcs-bucket.sh
```

**Order:** enable proxy + deploy code → smoke `/medias/public/` images → then PAP / remove `allUsers`.  
**Rollback:** temporarily re-add `allUsers:objectViewer` and set PAP to `inherited` only if emergency; prefer keeping proxy ON.

See also: `africa-meals-infra/docs/MONGODB_BACKUP.md` (GCS backups use authenticated SA — compatible with private buckets).

## 8. How the API uses Storage

- **Upload**: `MediasService.upload(file, user, basePath)` uploads to `{basePath}/{uuid}.{ext}` and returns the download URL (via `getDownloadURL` for Firebase, or proxy URL for private GCS).
- **Delete**: `MediasService.delete(pathOrUrl)` deletes by path or by full Firebase Storage URL (path is extracted automatically).
- **Paths**: Profile images use paths like `users/{userId}/profile/...` and `stores/{storeId}/profile/...`.

The app initializes the Firebase Admin app in `SharedModule` and injects it (and the bucket name) into `MediasService`.

## 9. Key rotation

If a service account JSON was ever committed to Git, follow [FIREBASE_KEY_ROTATION.md](./FIREBASE_KEY_ROTATION.md) immediately.
