# Amazon S3 – stockage médias privé + proxy API

Le moteur **S3** (`AWS_S3_BUCKET`) sert les uploads médias (plats, profils, preuves livraison, etc.) via `MediasService`. En production le bucket est **privé** : **Block all public access** activé, **pas** de CloudFront — les clients lisent via le proxy Nest `GET /medias/public/{objectPath}`.

## Architecture

```
Client (mobile / admin / web)
  → https://{API_PUBLIC_BASE_URL}/medias/public/{key}
       → MediasPublicProxyMiddleware
            → S3 GetObject (credentials IAM)
                 → bucket privé (BlockPublicAccess ON)

Upload :
Client → API multipart
  → PutObject **sans** ACL public-read
  → Mongo stocke l’URL proxy
```

## Variables d’environnement

| Variable | Valeur prod |
|---|---|
| `AWS_S3_BUCKET` | Nom du bucket (ex. `wise-eat`) |
| `AWS_REGION` | ex. `us-east-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM least privilege |
| `AWS_S3_PUBLIC_READ` | `false` ou **unset** |
| `AWS_S3_PUBLIC_BASE_URL` | **ne pas définir** (pas de CDN) |
| `API_PUBLIC_BASE_URL` | Base publique de l’API (URLs proxy) |
| `STORAGE_OBJECT_ACL` | `false` recommandé |

Voir aussi `.env.example` (section Amazon S3).

## Production private bucket (Block Public Access)

Checklist pour `AWS_S3_BUCKET` :

1. Déployer API/admin avec proxy médias forcé quand le pool d’upload inclut **S3** (Admin → Stockage ; l’API force aussi `mediaProxyEnabled`).
2. Env : `AWS_S3_PUBLIC_READ=false`, **pas** de `AWS_S3_PUBLIC_BASE_URL`.
3. Smoke test :
   ```bash
   curl -sI "https://$API_PUBLIC_BASE_URL/medias/public/<clé-connue>" | head -5
   # Attendu : HTTP 200 + Content-Type image/*
   ```
4. Normaliser les URLs Mongo encore en `*.s3.amazonaws.com` :

   **Prod VPS (recommandé) — dans le pod API** (image Docker déjà buildée : `dist/` + deps runtime,
   pas de `@nestjs/cli` / `tsconfig-paths` sur `/opt/wise-eat-api`) :

   ```bash
   # Après deploy de l’image qui contient dist/scripts/media-url-normalize.js
   POD=$(sudo k3s kubectl get pods -n wise-eat \
     -l app.kubernetes.io/name=africa-meals-api \
     -o jsonpath='{.items[0].metadata.name}')
   sudo k3s kubectl exec -n wise-eat "$POD" -- \
     node dist/scripts/media-url-normalize.js              # dry-run
   sudo k3s kubectl exec -n wise-eat "$POD" -- \
     node dist/scripts/media-url-normalize.js --apply
   ```

   Si le script manque dans le pod (`Cannot find module …/media-url-normalize.js`) :
   rebuild + redeploy API (`build-api-image.sh` / `deploy-api-production.sh`), puis rejouer.

   **Ne pas** lancer `npm run build` sur l’hôte `/opt/wise-eat-api` en prod (`nest: not found` =
   install `--omit=dev`). Le `dist/` compilé n’a pas besoin de `-r tsconfig-paths/register`
   (imports relatifs).

   **Local / machine de dev** (avec devDependencies) :
   ```bash
   npm run build
   npm run medias:normalize-urls            # dry-run
   npm run medias:normalize-urls -- --apply
   ```
5. Harden bucket (dry-run puis apply) — lit `AWS_*` depuis `/opt/wise-eat-api/.env.prod` :
   ```bash
   cd /opt/wise-eat   # africa-meals-infra
   ./scripts/harden-s3-bucket.sh
   APPLY=1 ./scripts/harden-s3-bucket.sh
   ```
   Si `AccessDenied` sur `put-public-access-block` : la clé API n’a que Get/PutObject —
   utiliser la console AWS → Permissions → **Block all public access** → Save
   (ou une clé IAM avec `s3:PutBucketPublicAccessBlock`).

**Ordre :** proxy + deploy → smoke `/medias/public/` → normalize-urls → Block Public Access.  
**Rollback d’urgence :** réouvrir temporairement la lecture publique bucket **uniquement** si le proxy est down ; préférer garder le proxy ON.

## IAM least privilege

- **API** : `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` sur `arn:aws:s3:::BUCKET` et `arn:aws:s3:::BUCKET/*`.
- **Backups Mongo** (préfixe `mongodb/`) : même bucket OK avec accès authentifié SA — compatible bucket privé. Voir `africa-meals-infra/docs/MONGODB_BACKUP.md`.

## Admin

Paramètres → Stockage :

- Cocher **Amazon S3** dans le pool d’upload → le toggle **Proxy API** est forcé ON (comme GCS).
- Description UI : bucket privé, Block Public Access, pas de CloudFront.

## Tests

- `storage-public-access.util.spec.ts` — S3 sans `AWS_S3_PUBLIC_READ` → pas de lecture directe.
- `storage-media-proxy-gate.util.spec.ts` — pool avec `s3` → proxy forcé.
- `medias.service.spec.ts` — `resolvePublicMediaUrl` réécrit vers `/medias/public/…`.
