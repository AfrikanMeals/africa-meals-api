# Déploiement sur Firebase Cloud Functions (NestJS)

## Fichiers d’environnement (k8s vs Functions)

| Fichier | Usage |
|---------|--------|
| **`.env`** | Production **k8s VPS** (`host.k3s.internal`, services `.svc.cluster.local`) — **ne pas** utiliser pour Firebase |
| **`.env.functions`** | Production **Firebase Cloud Functions** (DNS public `*.wise-eat.com`, gRPC désactivé) — source de vérité Functions |
| **`.env.wise-eat-ca`** | Généré au deploy : copie de `.env.functions` pour le projet Firebase `wise-eat-ca` (gitignored) |

Le script `npm run deploy:functions` :

1. Copie les packages monorepo `@africa-meals/*` dans `./packages/` (Cloud Build n’a pas le monorepo parent).
2. Copie **`.env.functions` → `.env.wise-eat-ca`** (le CLI Firebase charge `.env.<projectId>`).
3. Met **`.env` (k8s) de côté** temporairement (`.env.k8s.stash`) pour éviter qu’il écrase les variables Functions.
4. Build + `firebase deploy`, puis restaure `.env` et nettoie les artefacts temporaires.

**Upload** : `.firebaseignore` remplace `.gitignore` pour le deploy — `dist/` et `packages/` sont inclus (sinon l’archive ne pèse que quelques octets et Cloud Build échoue avec `function.js does not exist`).

**Région** : `APP_REGION=us-east1` dans `.env.functions` ; `firebase-main.ts` lit ce fichier à l’analyse du code (avant injection `process.env` par le CLI).

**Créer / maintenir** `.env.functions` à la racine de `africa-meals-api` (gitignored). Ne jamais y mettre `host.k3s.internal` ni `VPS_LOCAL_HOST` — Cloud Functions n’atteint pas le réseau k3s.

## Prérequis

- Compte Firebase / projet GCP
- CLI : `npm i -g firebase-tools` puis `firebase login`
- Copier `.firebaserc.example` vers `.firebaserc` et remplacer `VOTRE_PROJECT_ID_FIREBASE`

## Build & déploiement

```bash
cd africa-meals-api
npm install
# Vérifier que .env.functions existe (copie depuis un collègue ou .env k8s adapté)
npm run deploy:functions
```

`deploy:functions` exécute `scripts/firebase-deploy.mjs` : prepare (packages + `.env.wise-eat-ca`), build Nest → `dist/`, puis deploy.  
**Utilisez `npm run deploy:functions`** (et non un `firebase deploy` manuel avec `.env` k8s) : le dépôt pin `firebase-tools` en devDependency pour un comportement de nettoyage des images aligné avec GCP.

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

## ⚠️ Préfixe `FIREBASE_` interdit dans les fichiers env (déploiement)

Le CLI Firebase charge **`.env.wise-eat-ca`** (généré depuis `.env.functions`) lors de l’analyse du code. Les clés dont le nom **commence par** `FIREBASE_`, `X_GOOGLE_` ou `EXT_` sont **réservées** et provoquent :

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

En production Functions, les variables proviennent de **`.env.functions`** (copié en `.env.wise-eat-ca` au deploy et inclus dans l’artefact uploadé — voir `firebase.json` `!.env.wise-eat-ca`).

Pour les secrets sensibles (rotation, audit), préférer aussi Secret Manager :

1. **Secret Manager** : `firebase functions:secrets:set MONGODB_URI` puis lier le secret à la fonction dans la console Firebase ou via `runWith({ secrets: [...] })`.
2. **Paramètres Firebase** : `firebase functions:config:set` (legacy) ou **params** (`defineString`, etc.) pour Firebase Functions v2.

Variables utiles (alignées sur `.env.functions`) :

| Variable | Rôle |
|----------|------|
| `MONGODB_URI` ou `MONGO_URI` | URI MongoDB complète (prioritaire sur `DB_*`) |
| `DB_USERNAME`, `DB_PASSWORD`, `DB_HOST`, `DB_DATABASE` | Construction de l’URI si pas d’URI complète |
| `MONGOOSE_MAX_POOL` | Taille max du pool par instance (défaut `20`, plafond lecture env `100` ; chaque conteneur Functions a son propre pool) |
| `MONGOOSE_MIN_POOL`, `MONGOOSE_MAX_IDLE_MS`, `MONGOOSE_WAIT_QUEUE_MS` | Affinage pool / fermeture des sockets inactives |
| `MONGOOSE_SERVER_SELECTION_MS` | Timeout sélection serveur (défaut `8000`) |
| `MONGODB_APP_NAME` | Libellé client Atlas (défaut `africa-meals-api` si URI construite depuis `DB_*`) |
| `MAX_INSTANCES` | Plafond d’instances HTTP concurrentes (défaut `8` dans le code — impact direct sur connexions Mongo cumulées) |
| `DISABLE_SWAGGER` | `true` pour désactiver Swagger (cold start plus léger) |
| `APP_REGION` | Région Cloud Functions (défaut `us-east1` — aligné `.env.functions`) |
| `TIMEOUT_SEC`, `APP_MEMORY` | Surcharge optionnelle des options de la fonction (`APP_MEMORY` : `256MiB`, `512MiB`, `1GiB`, `2GiB`) |
| `AM_FIREBASE_PROJECT_ID` | ID projet Firebase / GCP (Admin SDK) |
| `AM_FIREBASE_STORAGE_BUCKET` | Bucket Storage (sinon `<project_id>.appspot.com`) |
| `AM_FIREBASE_SERVICE_ACCOUNT_JSON` | JSON compte de service (une ligne) |
| `AM_FIREBASE_SERVICE_ACCOUNT_PATH` | Chemin vers le fichier JSON **hors dépôt** |
| `AM_FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL` | E-mail compte de service (alternative champs discrets) |
| `AM_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` | Clé privée PEM (`\n` échappés) |
| `BIRD_ACCESS_KEY` | Access Key Bird (SMS + WhatsApp) — **secret** |
| `BIRD_WORKSPACE_ID` | UUID workspace Bird |
| `BIRD_SMS_CHANNEL_ID` | UUID canal SMS Bird |
| `BIRD_WHATSAPP_CHANNEL_ID` | UUID canal WhatsApp Bird |
| `AD_NOTIFICATION_SMS_ENABLED` | `true` pour activer SMS ads |
| `AD_NOTIFICATION_WHATSAPP_ENABLED` | `true` pour activer WhatsApp ads |
| `AD_NOTIFICATION_WHATSAPP_TEMPLATE_PROJECT_ID` | UUID template Bird Studio (mode template) |
| `API_PUBLIC_BASE_URL` | URL publique API (liens trackés SMS / WhatsApp ads) |

### Redis (Mode A-lite — VPS Stunnel, prod)

L’API Cloud Functions rejoint le Redis VPS via **Stunnel TLS** (`wise-eat.cloud:6381` / `:6382`), **sans Cloud NAT** (A-lite). Runbook : [../../docs/REDIS_VPS_PRODUCTION.md](../../docs/REDIS_VPS_PRODUCTION.md).

| Variable | Exemple prod |
|----------|----------------|
| `REDIS_URL` | `rediss://wise-eat-cache:***@wise-eat.cloud:6381` |
| `REDIS_TLS` | `true` |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | `true` ou omis avec **Certbot** ; `false` seulement si cert auto-signé |
| `BULLMQ_REDIS_URL` | `rediss://wise-eat-bull:***@wise-eat.cloud:6382` |
| `BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED` | idem |
| `SSE_REDIS_BRIDGE_ENABLED` | `true` |

Définir via Secret Manager / variables Firebase (comme MongoDB). Redéployer après mise à jour : `npm run deploy:functions`.

Les secrets **`BIRD_ACCESS_KEY`**, **`BIRD_WORKSPACE_ID`**, **`BIRD_SMS_CHANNEL_ID`** et **`BIRD_WHATSAPP_CHANNEL_ID`** sont liés automatiquement à la fonction `api` dans **`src/firebase-main.ts`** (`defineSecret` + option `secrets`). Créez-les avec `firebase functions:secrets:set` avant le premier déploiement post-migration Bird.

Guide complet Bird (prod, template, migration Twilio/Meta) : **[docs/BIRD_CHANNELS.md](BIRD_CHANNELS.md)**.

Après définition des secrets, **`src/firebase-main.ts`** déclare déjà les secrets Bird via `defineSecret` et les attache à la fonction `api` (`secrets: [...]`). Pour d’autres secrets (MongoDB, JWT, etc.), ajoutez-les de la même façon ou via la console Firebase.

## Émulateur local

```bash
npm run serve:functions
```

Configurer les mêmes variables (fichier `.env` local ou export shell) pour MongoDB, JWT, etc.

## Mobile / clients

En prod, la base URL API est celle de la fonction **`api`** **sans** segment `/api` supplémentaire dans le chemin (les routes correspondent à celles définies dans les contrôleurs Nest, ex. `/auth/login`).

En développement local avec `start:prod`, conserver le préfixe **`/api`** (ex. `http://localhost:3000/api/auth/login`).
