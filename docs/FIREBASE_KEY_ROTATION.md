# Rotation clé compte de service Firebase

## Contexte

Un fichier `accounts.json` (clé privée Firebase Admin SDK) a été versionné dans le dépôt. Même après retrait du fichier et ajout au `.gitignore`, **toute clé exposée doit être considérée compromise** et révoquée.

## Actions immédiates (ops)

1. **Firebase Console** → Projet `wise-eat-com` → **Paramètres** → **Comptes de service**
2. Ouvrir le compte `firebase-adminsdk-fbsvc@wise-eat-com.iam.gserviceaccount.com`
3. **Gérer les clés** → supprimer la clé dont l’ID était exposé dans l’historique Git (`private_key_id` visible dans les commits)
4. **Générer une nouvelle clé privée** et la stocker uniquement via :
   - `AM_FIREBASE_SERVICE_ACCOUNT_JSON` (Secret Manager / CI), ou
   - `AM_FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL` + `AM_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`, ou
   - fichier local **hors dépôt** via `AM_FIREBASE_SERVICE_ACCOUNT_PATH`
5. Redéployer l’API avec la nouvelle clé
6. Vérifier FCM, Storage et Auth Admin (`verifyIdToken`)

## Prévention

- `accounts.json` et variantes sont dans `.gitignore`
- Modèle sans secret : `accounts.json.example`
- Ne jamais committer de JSON de compte de service

## Vérification post-rotation

```bash
# FCM / Storage : logs au démarrage
# Attendu : FirebaseAdmin Initialisé (projet=wise-eat-com, bucket=...)

# Optionnel : test upload média ou envoi notification push en staging
```

## Références

- [FIREBASE_STORAGE.md](./FIREBASE_STORAGE.md)
- [FIREBASE_FUNCTIONS.md](./FIREBASE_FUNCTIONS.md)
- Finding audit **C-02** dans [SECURITY_AUDIT.md](./SECURITY_AUDIT.md)
