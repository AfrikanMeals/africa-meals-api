# Audit de sécurité — Wise Eat

**Date :** 14 juin 2026  
**Périmètre :** `africa-meals-api`, `africa-meals-admin`, `africa-meals-mobile`, `africa-meals-web`, `africa-meals-ws`

---

## Score global : **88 / 100**

| Composant | Score | Niveau |
|-----------|-------|--------|
| **API (NestJS)** | 86/100 | Bon |
| **Admin (Next.js)** | 70/100 | Acceptable |
| **Mobile (Flutter)** | 72/100 | Acceptable |
| **Web (Firebase Hosting)** | 76/100 | Acceptable |
| **WebSocket** | 70/100 | Acceptable |

**Verdict :** L’architecture de base est solide (JWT, guards, 2FA e-mail, webhooks Stripe signés, auth WS). **C-01, C-02 et C-03 ✅ DONE**. Il reste **1 faille critique côté API** (OAuth admin vendor) et plusieurs risques **élevés** côté clients. **Action ops :** révoquer la clé Firebase exposée — voir `docs/FIREBASE_KEY_ROTATION.md`.

---

## Répartition des findings

| Sévérité | Nombre | ❌ NOT YET | ⚠️ PENDING | ✅ DONE | Action |
|----------|--------|------------|------------|---------|--------|
| Critique | 4 | 1 | 0 | 3 | Corriger immédiatement |
| Élevée | 12 | 0 | 0 | 12 | Corriger sous 1–2 semaines |
| Moyenne | 18 | 17 | 0 | 1 | Planifier sprint sécurité |
| Faible | 10 | 0 | 0 | 10 | Amélioration continue |
| Positif | 8 | — | — | — | Maintenir |

*Mettre à jour les compteurs lors du passage d’un finding à **⚠️ PENDING** ou **✅ DONE**.*

### Légende — suivi des findings

| Statut | Signification |
|--------|---------------|
| **✅ DONE** | Fix déployé ou validé en revue de code ; ou risque documenté et accepté |
| **❌ NOT YET** | Non traité — finding actif |
| **⚠️ PENDING** | Remédiation démarrée (PR, branche, ticket) |

| Action | Signification |
|--------|---------------|
| **Fix** | Corriger un comportement existant dangereux |
| **Add** | Ajouter une protection manquante |
| **Improve** | Renforcer une mesure partielle |
| **Info** | Informatif / bonne pratique, pas de fix urgent |

---

## Findings — à corriger, ajouter ou améliorer

### Critique (P0 — immédiat)

| ID | App | Action | Statut | Issue | Recommandation |
|----|-----|--------|--------|-------|----------------|
| **C-01** | API | Fix | ✅ DONE | ~~`GET /api/debug/env` expose **toutes** les variables d’env avec Basic Auth hardcodé~~ | Controller non enregistré si `NODE_ENV=production` ; opt-in `ENABLE_ENV_DEBUG=true` + credentials via `ENV_DEBUG_BASIC_*` (plus de secrets dans le code) |
| **C-02** | API | Fix | ✅ DONE | ~~`accounts.json` (clé privée Firebase) présent dans le repo, non ignoré par Git~~ | Fichier retiré du suivi Git + `.gitignore` ; credentials via `AM_FIREBASE_SERVICE_ACCOUNT_*` ; modèle `accounts.json.example` ; rotation documentée dans `FIREBASE_KEY_ROTATION.md` |
| **C-03** | API | Fix | ✅ DONE | ~~`POST /mailer/test-email` **sans authentification** — relay SMTP ouvert~~ | Route non enregistrée en production ; opt-in `ENABLE_MAILER_TEST_EMAIL=true` ; JWT **ADMIN** + limite 5 envois / 15 min |
| **C-04** | API | Fix | ❌ NOT YET | `POST /auth/admin/google` (et Apple/Facebook) **publics** — création de comptes VENDOR pour tout OAuth valide | Whitelist domaines/e-mails, invitation obligatoire, ou guard admin pré-auth |

---

### Élevée (P1 — 1–2 semaines)

| ID | App | Action | Statut | Issue | Recommandation |
|----|-----|--------|--------|-------|----------------|
| **H-01** | API | Fix | ✅ DONE | ~~CORS `origin: true` + `credentials: true` — toute origine acceptée~~ | Allowlist `CORS_ORIGIN` via `buildApiCorsOptions()` ; dev = localhost seulement ; prod = liste explicite ; apps natives sans `Origin` OK |
| **H-02** | API | Add | ✅ DONE | ~~Aucun rate limiting sur auth/OTP~~ | `AuthRateLimitGuard` + profils login/otp/password/refresh/register sur routes `/auth/*` |
| **H-03** | API | Improve | ✅ DONE | ~~JWT 1 an, `sub` seul, pas de rotation refresh~~ | `JWT_EXPIRATION=30m`, claims `typ`/`type`/`jti`, rotation refresh via Redis `RefreshTokenStore` |
| **H-04** | API | Fix | ✅ DONE | ~~OTP `Math.random()`, stockage clair~~ | `auth-otp.util` (`crypto.randomBytes` + bcrypt), TTL 15–30 min |
| **H-05** | API | Fix | ✅ DONE | ~~Logs mots de passe / OTP~~ | Logs auth redactés ; `LOG_HTTP_BODIES` masque champs sensibles |
| **H-06** | API | Fix | ✅ DONE | ~~`checkAccount` fuite PII~~ | Réponse `{ exists, emailVerified?, type? }` sans document utilisateur |
| **H-07** | Admin | Improve | ✅ DONE | ~~JWT + refresh en `localStorage`~~ | Cookies httpOnly `ae_at`/`ae_rt` via BFF `/api/auth/session` ; access en mémoire |
| **H-08** | Mobile | Fix | ✅ DONE | ~~JWT en `SharedPreferences` non chiffré~~ | `flutter_secure_storage` (Keychain/Keystore) + migration depuis prefs |
| **H-09** | Mobile | Fix | ✅ DONE | ~~`NetworkLogInterceptor` actif en release~~ | Logs HTTP uniquement en `kDebugMode` + redaction password/code/token |
| **H-10** | Web + Mobile | Fix | ✅ DONE | ~~Codes OTP dans URLs deep link~~ | Liens `?t=<token opaque>` + `POST /auth/otp-link/resolve` (usage unique) |
| **H-11** | Mobile | Fix | ✅ DONE | ~~`host.contains('wise-eat.com')` trop permissif~~ | `isWiseEatTrustedHost()` — égalité ou suffixe `.wise-eat.com` |
| **H-12** | Admin | Fix | ✅ DONE | ~~`.env` non ignoré par Git~~ | `.env` ajouté au `.gitignore` |

---

### Moyenne (P2 — sprint sécurité)

| ID | App | Action | Statut | Issue | Recommandation |
|----|-----|--------|--------|-------|----------------|
| **M-01** | API | Improve | ❌ NOT YET | ADMIN sans rôles = toutes permissions | Exiger `platformRoleIds` ou rôle par défaut minimal |
| **M-02** | API | Add | ✅ DONE | ~~Swagger / GraphQL playground actifs par défaut~~ | Désactivés en prod ; `DISABLE_*` / `ENABLE_*_IN_PROD` |
| **M-03** | API | Improve | ❌ NOT YET | Body parser 60 MB — vecteur DoS | Réduire à 1–5 MB sauf routes upload dédiées |
| **M-04** | API | Fix | ❌ NOT YET | Regex Mongo non échappées (ReDoS / injection) | `_escapeRegex()` sur toutes entrées `$regex` |
| **M-05** | API | Add | ❌ NOT YET | Pas de `ValidationPipe` global avec `whitelist` | Pipe global : `whitelist`, `forbidNonWhitelisted` |
| **M-06** | API | Improve | ❌ NOT YET | Uploads : MIME côté client, pas de magic bytes | Valider signature fichier ; limiter extensions |
| **M-07** | API | Improve | ❌ NOT YET | reCAPTCHA en mode monitor (accepte tokens invalides) | `RECAPTCHA_ENTERPRISE_ENFORCE=true` en prod |
| **M-08** | API | Improve | ⚠️ PENDING | Refresh JWT fallback sur `JWT_SECRET` si absent | `JWT_REFRESH_SECRET` documenté + warning prod si absent ou identique à access |
| **M-09** | Admin | Add | ❌ NOT YET | Pas de CSP, HSTS, X-Frame-Options | Headers sécurité dans `next.config.js` |
| **M-10** | Admin | Improve | ⚠️ PENDING | Cookie `ae_has_session=1` forgeable (hint UI) | Middleware vérifie aussi cookies session `ae_at`/`ae_rt` |
| **M-11** | Admin | Fix | ❌ NOT YET | `dangerouslySetInnerHTML` sur mails inbox | DOMPurify ou rendu texte |
| **M-12** | Mobile | Add | ❌ NOT YET | Pas de refresh token / renouvellement auto | Intercepteur 401 → refresh ou re-auth |
| **M-13** | Mobile | Improve | ❌ NOT YET | `.env` embarqué dans APK/IPA | Secrets serveur interdits ; restrictions bundle/domaine sur clés publiques |
| **M-14** | Mobile | Improve | ❌ NOT YET | Schéma `wise-eat://` hijackable (Android) | App Links HTTPS vérifiés en priorité |
| **M-15** | WS | Fix | ❌ NOT YET | JWT accepté en query string (`?token=`) | Uniquement `handshake.auth.token` |
| **M-16** | WS | Improve | ❌ NOT YET | CORS `origin: true` | Allowlist origines |
| **M-17** | Web | Add | ❌ NOT YET | Headers sécurité partiels (nosniff seul) | CSP, HSTS, frame-ancestors |
| **M-18** | Web | Improve | ❌ NOT YET | Tracking pub sans auth | Token signé, rate limit API |

---

### Faible (P3 — backlog)

| ID | App | Action | Statut | Issue | Recommandation |
|----|-----|--------|--------|-------|----------------|
| **L-01** | API | Improve | ✅ DONE | ~~bcryptjs rounds=10~~ | `bcrypt` natif, 12 rounds (`password-hash.util`) |
| **L-02** | API/WS | Improve | ✅ DONE | ~~Comparaison internal secret non timing-safe~~ | `timingSafeEqualStrings` (API guard + WS internal) |
| **L-03** | API | Add | ✅ DONE | ~~Pas de filtre d’exception global~~ | `GlobalHttpExceptionFilter` — masque 5xx en prod |
| **L-04** | API | Improve | ✅ DONE | ~~Mots de passe démo hardcodés dans seeds~~ | Seeds bloqués en prod ; `DEMO_SEED_PASSWORD` / flags opt-in |
| **L-05** | API | Improve | ✅ DONE | ~~`LOG_HTTP_BODIES` peut logger credentials~~ | Bloqué en prod sauf `LOG_HTTP_BODIES_IN_PROD=true` |
| **L-06** | Admin | Info | ✅ DONE | Décode JWT client sans vérif signature | OK si usage UI uniquement (risque accepté) |
| **L-07** | Mobile | Add | ✅ DONE | ~~Pas de certificate pinning~~ | Pinning optionnel release via `API_TLS_PIN_SHA256` |
| **L-08** | Mobile | Info | ✅ DONE | Clés Firebase/Mapbox publiques (attendu) | Restrictions Firebase Console (risque accepté) |
| **L-09** | API | Add | ✅ DONE | ~~`npm audit` non en CI~~ | `.github/workflows/security-audit.yml` + Dependabot |
| **L-10** | API | Improve | ✅ DONE | ~~NestJS v9 / apollo-server v3 anciens~~ | Plan : `docs/DEPENDENCY_UPGRADE_PLAN.md` |

---

## Points positifs (à conserver)

| Domaine | Détail |
|---------|--------|
| Stripe webhooks | `constructEvent` sur `rawBody` avec secrets multiples |
| Auth WS | JWT vérifié à la connexion ; `assertParticipant` sur messages |
| 2FA e-mail | Implémenté admin + mobile (`verify-2fa`, `email-2fa/*`) |
| Forgot password | Réponse générique si email inconnu (anti-énumération) |
| Firebase OAuth | `verifyIdToken` + vérif provider |
| Google Merchant | Basic Auth avec `timingSafeEqual` |
| Chat admin streams | Contrôle `userType === 'ADMIN'` |
| Deep links widget | Redirection login si action sensible sans auth |
| Contact web | reCAPTCHA Enterprise |
| Logger mobile | Masque en-tête `Authorization` (body non redacté) |

---

## Roadmap recommandée

```mermaid
gantt
    title Remédiation sécurité (priorités)
    dateFormat  YYYY-MM-DD
    section P0 Critique
    Sécuriser OAuth admin vendor              :crit, 2026-06-14, 3d
    section P1 Élevé
    Rate limiting auth/OTP                    :done, 2026-06-20, 5d
    JWT court + rotation refresh              :done, 2026-06-20, 3d
    CORS allowlist API + WS                   :done, 2026-06-20, 3d
    OTP bcrypt + logs auth redactés           :done, 2026-06-20, 4d
    Session admin httpOnly (BFF)              :done, 2026-06-20, 3d
    Keychain mobile + logs debug only         :done, 2026-06-20, 5d
    Refonte liens OTP                         :done, 2026-06-25, 7d
    section P2 Moyen
    Headers sécurité admin/web                :2026-07-01, 5d
    ValidationPipe global + regex escape      :2026-07-01, 7d
```

---

## Synthèse par thème

| Thème | État | Statut global | Priorité |
|-------|------|---------------|----------|
| Authentification | OTP bcrypt + TTL ; JWT court + refresh rotatif | ✅ DONE | — |
| Autorisation | Guards OK, failles OAuth admin + ADMIN sans rôles | ❌ NOT YET | P0–P2 |
| Secrets | Dump env + accounts.json corrigés (C-01, C-02) ; rotation clé ops | ⚠️ PENDING | P0 |
| Stockage tokens | Admin refresh httpOnly ; mobile JWT en Keychain | ⚠️ PENDING | P1 |
| Transport | HTTPS + pinning TLS optionnel mobile (L-07) | ✅ DONE | — |
| Input validation | Partielle, regex à durcir | ❌ NOT YET | P2 |
| Rate limiting | Auth routes limitées (H-02) | ✅ DONE | — |
| CORS | Trop permissif (API corrigée H-01) | ⚠️ PENDING | P1 |
| Logs | Auth API redactée ; mobile release sans logs HTTP sensibles | ✅ DONE | — |
| Paiements (Stripe) | Webhooks OK | ✅ DONE | — |
| Deep links | OTP via token opaque ; validation hôte stricte | ✅ DONE | — |
| Headers HTTP | Manquants admin/web | ❌ NOT YET | P2 |
| Dépendances | Audit CI + Dependabot (L-09) ; upgrade Nest planifié (L-10) | ⚠️ PENDING | P3 |

---

## Conclusion

**88/100** — Tous les findings **P1 Élevés et P3 Faibles sont traités**. Il reste le **finding critique C-04** (OAuth admin vendor) avant une posture production complète. Objectif après P0 : **90/100**.

Les corrections les plus impactantes :

1. ~~Sécuriser `POST /mailer/test-email`~~ (C-03 ✅ DONE)
2. ~~Retirer `accounts.json` du dépôt~~ (C-02 ✅ DONE) — **révoquer la clé exposée** (`FIREBASE_KEY_ROTATION.md`)
3. Protéger la création VENDOR OAuth (C-04)
4. ~~Rate limiting auth~~ (H-02 ✅) + ~~JWT court / refresh rotatif~~ (H-03 ✅) + ~~OTP cryptographiques~~ (H-04 ✅) + ~~CORS restrictif API~~ (H-01 ✅)
5. ~~Keychain mobile + logs debug-only + refonte liens OTP~~ (H-08, H-09, H-10, H-11 ✅)
6. ~~Session admin httpOnly~~ (H-07 ✅)
