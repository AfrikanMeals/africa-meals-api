# Déploiement sur Firebase Cloud Functions (NestJS)

## Prérequis

- Compte Firebase / projet GCP
- CLI : `npm i -g firebase-tools` puis `firebase login`
- Copier `.firebaserc.example` vers `.firebaserc` et remplacer `VOTRE_PROJECT_ID_FIREBASE`

## Build & déploiement

```bash
cd africa-meals-api
npm install
npm run deploy:functions
```

Le `predeploy` exécute `npm run build` (compilation Nest → `dist/`).  
**Utilisez `npm run deploy:functions`** (et non un `firebase` global ancien) : le dépôt pin `firebase-tools` en devDependency pour un comportement de nettoyage des images aligné avec GCP.

### Avertissement « Unhandled error cleaning up build images »

Après le déploiement, le CLI tente de supprimer d’anciennes images (GCR / Artifact Registry). Un **404** (dépôt inexistant ou déjà nettoyé) ou des **droits IAM** insuffisants produisent ce message ; le déploiement peut quand même être **réussi**.

**À faire :**

1. **Mettre à jour les deps** : `npm install` dans `africa-meals-api` (firebase-tools ≥ 15 dans ce projet).
2. **Politique de rétention Artifact Registry** (recommandé, une fois par région utilisée, ex. `europe-west1`) :
   ```bash
   npm run functions:artifacts-policy
   ```
   Cela configure un nettoyage automatique des images obsolètes dans `gcf-artifacts`.
3. **Compte qui lance `firebase deploy`** : sur la console GCP → IAM, vérifier le rôle **Artifact Registry Administrator** (`roles/artifactregistry.admin`) ou au minimum les permissions de suppression sur le dépôt `gcf-artifacts` (projet `afrikanmeals`, région `europe-west1`).
4. **Images orphelines** : lien indiqué dans le message (ex. `console.cloud.google.com/gcr/images/.../gcf`) pour suppression manuelle si besoin.

### Build Cloud Functions (Yarn) et BSON

Le build GCP utilise souvent **Yarn** (`…/yarn_modules/…`). Les **`overrides`** du `package.json` sont **npm uniquement** ; pour forcer **bson 6.x** partout, le projet définit aussi **`resolutions`** (Yarn).  
En application : n’utilisez pas `ObjectId` depuis le paquet `mongodb` avec **Mongoose 8** — préférez **`Types.ObjectId`** depuis `mongoose`, sinon erreur en prod : `BSONVersionError: bson types must be from bson 6.x.x`.

## Point d’entrée

- **`package.json` → `main`** : `dist/firebase-main.js` (export de la fonction HTTP `api`)
- **Local (sans Firebase)** : `npm run start:prod` → `dist/main.js` (préfixe global `/api`)

## URLs

- Fonction nommée **`api`** (Gen 2) :  
  `https://<region>-<project>.cloudfunctions.net/api/<route>`

### Health check

- **Production (exemple)** :  
  `GET https://europe-west1-afrikanmeals.cloudfunctions.net/api/health`  
  (remplacez `europe-west1` / `afrikanmeals` si votre région ou projet diffère.)

Réponse JSON typique :

```json
{
  "status": "ok",
  "service": "africa-meals-api",
  "version": "0.0.1",
  "timestamp": "2026-03-08T12:00:00.000Z",
  "uptimeSeconds": 123.456
}
```

- **En local** (avec préfixe `api`) :  
  `GET http://localhost:3000/api/health`  
  ou `http://localhost:<NODE_PORT>/api/health` si `NODE_PORT` / `PORT` est défini.
- Sur Cloud Functions, le préfixe Nest est **vide** pour éviter `/api/api/...`.  
  Exemple : `.../api/auth/login` (et non `.../api/api/auth/login`).

### Documentation OpenAPI (Swagger)

- **API principale** (`africa-meals-api`) : UI **`/api/docs`** en local (`npm run start:prod` → ex. `http://localhost:3000/api/docs`).  
  Sur Cloud Functions, l’URL publique est `https://<hôte-de-la-fonction>/api/docs` (sans préfixe Nest en double sur le path applicatif — voir ci‑dessus).  
  Désactivation : `DISABLE_SWAGGER=true` (déjà documenté dans le tableau des variables).
- **Service chat / WebSocket** (`africa-meals-ws`, Cloud Run **`ws`**) : même convention — **`/api/docs`**, JWT identique. Détails : voir le README du dépôt **`africa-meals-ws`** (section OpenAPI / déploiement Cloud Run).

## ⚠️ Préfixe `FIREBASE_` interdit dans `.env` (déploiement)

Le CLI Firebase charge le fichier **`.env`** à la racine du projet lors de l’analyse du code. Les clés dont le nom **commence par** `FIREBASE_`, `X_GOOGLE_` ou `EXT_` sont **réservées** et provoquent :

`Error: Failed to load environment variables from .env`  
`Key FIREBASE_… starts with a reserved prefix`

**Correctif :**

1. **Admin SDK (Nest / Storage)** — utiliser exclusivement :
   - `AM_FIREBASE_PROJECT_ID`
   - `AM_FIREBASE_STORAGE_BUCKET`
   - `AM_FIREBASE_SERVICE_ACCOUNT_JSON` ou `AM_FIREBASE_SERVICE_ACCOUNT_PATH`  
   (le code lit ces noms ; renommez les anciennes `FIREBASE_*` dans votre `.env` local.)
2. **Clés « client »** (API key, App ID, etc., copiées pour Flutter) — ne les mettez **pas** dans ce `.env` avec le préfixe `FIREBASE_`, ou renommez-les (ex. `AM_WEB_API_KEY`, `AM_WEB_AUTH_DOMAIN`, …). Elles ne sont en général **pas** utilisées par l’API Nest.

## Variables d’environnement

En production, ne pas s’appuyer sur un fichier `.env` déployé (il est ignoré par `firebase.json`).

Options recommandées :

1. **Secret Manager** (recommandé pour la base, JWT, clés) :  
   `firebase functions:secrets:set MONGODB_URI` puis lier le secret à la fonction dans la console Firebase ou via `runWith({ secrets: [...] })`.
2. **Paramètres Firebase** : `firebase functions:config:set` (legacy) ou **params** (`defineString`, etc.) pour Firebase Functions v2.

Variables utiles (alignées sur l’existant) :

| Variable | Rôle |
|----------|------|
| `MONGODB_URI` ou `MONGO_URI` | URI MongoDB complète (prioritaire sur `DB_*`) |
| `DB_USERNAME`, `DB_PASSWORD`, `DB_HOST`, `DB_DATABASE` | Construction de l’URI si pas d’URI complète |
| `MONGOOSE_MAX_POOL` | Taille du pool (défaut `10`) |
| `MONGOOSE_SERVER_SELECTION_MS` | Timeout sélection serveur (défaut `8000`) |
| `DISABLE_SWAGGER` | `true` pour désactiver Swagger (cold start plus léger) |
| `FUNCTION_REGION` | Région (défaut `europe-west1` dans le code) |
| `FUNCTION_TIMEOUT_SEC`, `FUNCTION_MEMORY` | Surcharge optionnelle des options de la fonction |
| `AM_FIREBASE_PROJECT_ID` | ID projet Firebase / GCP (Admin SDK) |
| `AM_FIREBASE_STORAGE_BUCKET` | Bucket Storage (sinon `<project_id>.appspot.com`) |
| `AM_FIREBASE_SERVICE_ACCOUNT_JSON` | JSON compte de service (une ligne) |
| `AM_FIREBASE_SERVICE_ACCOUNT_PATH` | Chemin vers le fichier JSON (alternative) |

Après définition des secrets, ajoutez-les dans `src/firebase-main.ts` via l’option `secrets` de `onRequest` / `setGlobalOptions` si vous utilisez l’API Secrets de Firebase Functions v2.

## Émulateur local

```bash
npm run serve:functions
```

Configurer les mêmes variables (fichier `.env` local ou export shell) pour MongoDB, JWT, etc.

## Mobile / clients

En prod, la base URL API est celle de la fonction **`api`** **sans** segment `/api` supplémentaire dans le chemin (les routes correspondent à celles définies dans les contrôleurs Nest, ex. `/auth/login`).

En développement local avec `start:prod`, conserver le préfixe **`/api`** (ex. `http://localhost:3000/api/auth/login`).
