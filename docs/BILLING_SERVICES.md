# Inventaire des services — Wise Eat / Wise Eat

Synthèse des prestataires externes utilisés par les 5 applications du monorepo, pour évaluer la facturation.

**Projet Firebase / GCP principal :** `wise-eat-ca` / `afrikanmeals`  
**Domaine public :** `wise-eat.com`

### Colonnes à compléter


| Colonne         | Valeurs / format                                                                              |
| --------------- | --------------------------------------------------------------------------------------------- |
| **Gratuit ?**   | `Oui` · `Non` · `Partiel` · `N/A` (ou laisser vide si non évalué)                             |
| **Lien tarifs** | URL de la page pricing / calculateur (ex. `https://…`) ou lien Markdown `[tarifs](https://…)` |


---

## Vue d'ensemble par application


| Application             | Rôle                        | Hébergement principal                                         | Gratuit ? | Lien tarifs |
| ----------------------- | --------------------------- | ------------------------------------------------------------- | --------- | ----------- |
| **africa-meals-api**    | API NestJS (REST + GraphQL) | Google Cloud Run (`api`) et/ou Firebase Cloud Functions Gen 2 | ⚠️        |             |
| **africa-meals-ws**     | WebSocket / chat temps réel | Google Cloud Run (`ws`)                                       | ❌         |             |
| **africa-meals-admin**  | Dashboard vendeur (Next.js) | Vercel                                                        | ✅         |             |
| **africa-meals-web**    | Site vitrine statique       | Firebase Hosting                                              | ✅         |             |
| **africa-meals-mobile** | App Flutter iOS / Android   | App Store + Google Play                                       | ❌         |             |


---

## 1. Infrastructure & cloud (GCP / Firebase)


| Service                            | Utilisé par     | Usage                                                                                  | Facturation typique                    | Gratuit ? | Lien tarifs                                                                                              |
| ---------------------------------- | --------------- | -------------------------------------------------------------------------------------- | -------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| **Google Cloud Run**               | API, WS         | Conteneurs `api` (2 vCPU, max 4 inst.) et `ws` (1 vCPU, max 8 inst.) en `europe-west1` | CPU, mémoire, requêtes, trafic sortant | ❌         | [https://cloud.google.com/run/pricing](https://cloud.google.com/run/pricing)                             |
| **Firebase Cloud Functions Gen 2** | API             | Déploiement alternatif de l'API NestJS (`dist/firebase-main.js`)                       | Invocations, CPU, mémoire, egress      | ⚠️        | [https://firebase.google.com/pricing](https://firebase.google.com/pricing)                               |
| **Firebase Hosting**               | Web             | Site `wise-eat.com`, `.well-known`, sitemaps                                           | Stockage + bande passante              | ✅         | [https://firebase.google.com/pricing](https://firebase.google.com/pricing)                               |
| **Firebase Storage**               | API             | Médias (images plats, logos, etc.) via `firebase-admin/storage`                        | Stockage + téléchargements             | ⚠️        | [https://firebase.google.com/pricing](https://firebase.google.com/pricing)                               |
| **Google Cloud Secret Manager**    | API (Functions) | Secrets Bird, compte de service Firebase                                               | Secrets stockés + accès                | ⚠️        | [https://cloud.google.com/secret-manager/pricing](https://cloud.google.com/secret-manager/pricing)       |
| **Google Artifact Registry**       | API (Functions) | Images Docker Cloud Functions (`gcf-artifacts`)                                        | Stockage images                        | ⚠️        | [https://cloud.google.com/artifact-registry/pricing](https://cloud.google.com/artifact-registry/pricing) |
| **GitHub Actions**                 | Web             | CI/CD Firebase Hosting (push `main`, PR previews)                                      | Minutes GitHub (gratuit selon plan)    | ✅         |                                                                                                          |


---

## 2. Base de données & cache


| Service           | Utilisé par | Usage                                                                                                                              | Facturation typique                                          | Gratuit ? | Lien tarifs                                                                                                                               |
| ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **MongoDB Atlas** | API, WS     | Base partagée (`main.8zkud1m.mongodb.net`) — commandes, users, chat, etc.                                                          | Cluster M0/M10+, connexions, stockage, backup                | ⚠️        | [https://www.mongodb.com/pricing](https://www.mongodb.com/pricing)                                                                        |
| **Redis**         | API, WS     | Cache Nest (`cache-manager-redis-yet`) + files **BullMQ** : `ads-notify`, `admin-alert-email`, `ws-notify`, `ws-internal-dispatch` | Instance managée ou self-hosted (Upstash, Redis Cloud, etc.) | ❌         | [https://redis.io/pricing/#cloud](https://redis.io/pricing/#cloud) [https://upstash.com/pricing/redis](https://upstash.com/pricing/redis) |


---

## 3. Messagerie temps réel


| Service                     | Utilisé par       | Usage                                             | Facturation typique                   | Gratuit ? | Lien tarifs                                                                                                                                                       |
| --------------------------- | ----------------- | ------------------------------------------------- | ------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Socket.IO**               | WS, Admin, Mobile | Chat vendeur ↔ client (self-hosted sur Cloud Run) | Inclus dans Cloud Run                 | -         | -                                                                                                                                                                 |
| **MQTT (ex. HiveMQ Cloud)** | API, WS           | Bus interne `africameals/internal/ws` (optionnel) | Broker managé par message / connexion | ⚠️        | [https://www.emqx.com/en/pricing](https://www.emqx.com/en/pricing) [https://www.hivemq.com/pricing/fully-managed/](https://www.hivemq.com/pricing/fully-managed/) |


---

## 4. Paiements


| Service        | Utilisé par         | Usage                                                                                                                                                            | Facturation typique                                     | Gratuit ? | Lien tarifs                                              |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------- | -------------------------------------------------------- |
| **Stripe**     | API, Admin, Mobile  | Checkout, Payment Sheet (Apple/Google Pay), abonnements vendeur, crédit pub, **Stripe Connect** (versements), remboursements, pénalités, facturation SMS vendeur | % + frais fixes par transaction ; Connect ; abonnements | ❌         | [https://stripe.com/pricing](https://stripe.com/pricing) |
| **PayPal**     | API, Mobile         | Méthodes de paiement enregistrées (`PAYPAL`, `PAYPAL_CARD`)                                                                                                      | % par transaction                                       | -         | -                                                        |
| **Apple Pay**  | Mobile (via Stripe) | Paiement natif iOS                                                                                                                                               | Inclus Stripe ; compte Apple Developer séparé           | -         | -                                                        |
| **Google Pay** | Mobile (via Stripe) | Paiement natif Android                                                                                                                                           | Inclus Stripe                                           | -         | -                                                        |


---

## 5. E-mail


| Service                   | Utilisé par | Usage                                                                                                    | Facturation typique                         | Gratuit ? | Lien tarifs |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------- | ----------- |
| **Gmail SMTP**            | API         | E-mails transactionnels (inscription, reset MDP, factures PDF commande, rapports vendeur) via Nodemailer | Gratuit (limites Gmail) ou Google Workspace | ✅         |             |
| **Zoho Mail SMTP**        | API         | Alternative SMTP (`smtp.zoho.com`) dans le code mailer                                                   | Plan Zoho Mail                              | ✅         |             |
| **MailerSend**            | API         | Alternative à SMTP pour envois simples / templates                                                       | Volume d'e-mails / plan                     | -         |             |
| **E-mails marketing Ads** | API         | Canal séparé (`AD_SMTP_`*) pour notifications publicitaires                                              | Même fournisseur SMTP ou dédié              | ✅         |             |


---

## 6. SMS & WhatsApp


| Service                 | Utilisé par | Usage                                                                                                            | Facturation typique                        | Gratuit ? | Lien tarifs |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------- | ----------- |
| **Bird (Channels API)** | API         | SMS + WhatsApp : notifications pub, SMS vendeurs (commandes), facturation SMS mensuelle (re-facturée via Stripe) | Par SMS / message WhatsApp / template WABA | ❌         | -           |


> Migration documentée depuis Twilio/Meta — **Twilio n'est plus référencé** dans le code actuel.

---

## 7. Notifications push


| Service                            | Utilisé par        | Usage                                                                   | Facturation typique                          | Gratuit ? | Lien tarifs |
| ---------------------------------- | ------------------ | ----------------------------------------------------------------------- | -------------------------------------------- | --------- | ----------- |
| **Firebase Cloud Messaging (FCM)** | API, Admin, Mobile | Push promos, chat, commandes ; canal Android `african_meals_promotions` | Gratuit (quotas Firebase)                    | ✅         |             |
| **APNs**                           | Mobile (via FCM)   | Push iOS                                                                | Inclus via FCM ; certificats Apple Developer | ✅         |             |


---

## 8. Authentification


| Service                     | Utilisé par             | Usage                                                         | Facturation typique               | Gratuit ? | Lien tarifs |
| --------------------------- | ----------------------- | ------------------------------------------------------------- | --------------------------------- | --------- | ----------- |
| **Firebase Authentication** | API, Admin, Mobile, Web | Auth sociale + tokens ; domaine `wise-eat-ca.firebaseapp.com` | Gratuit jusqu'aux quotas Firebase | ✅         |             |
| **Google Sign-In**          | Mobile, Admin           | OAuth via Firebase + `GOOGLE_WEB_CLIENT_ID`                   | Gratuit                           | ✅         |             |
| **Facebook Login**          | Mobile                  | `flutter_facebook_auth` + Firebase                            | Gratuit (Meta Developer)          | ✅         |             |
| **Apple Sign-In**           | Mobile                  | `apple_firebase_sign_in`                                      | Compte Apple Developer (99 $/an)  | ✅         |             |
| **JWT maison**              | API, Admin, WS          | Sessions dashboard / tokens API                               | —                                 | ✅         |             |


---

## 9. Cartographie & géolocalisation


| Service                            | Utilisé par        | Usage                                                       | Facturation typique            | Gratuit ? | Lien tarifs                                                                                                      |
| ---------------------------------- | ------------------ | ----------------------------------------------------------- | ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------- |
| **Mapbox**                         | API, Admin, Mobile | Géocodage, cartes, itinéraires piéton/voiture, tuiles       | Requêtes API + loads de tuiles | ⚠️        | [https://www.mapbox.com/pricing](https://www.mapbox.com/pricing)                                                 |
| **Google Maps Platform**           | Admin, Mobile      | Moteur carte alternatif (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) | Geocoding, Maps JS, etc.       | ⚠️        | [https://mapsplatform.google.com/pricing/#pay-as-you-go](https://mapsplatform.google.com/pricing/#pay-as-you-go) |
| **OpenStreetMap / Nominatim**      | Mobile             | Tuiles de secours + géocodage page « Devenir vendeur »      | Gratuit (usage policy OSM)     | ✅         |                                                                                                                  |
| **Geolocator / Geocoding (natif)** | Mobile             | Position GPS, géocodage device                              | Gratuit                        | ✅         |                                                                                                                  |


---

## 10. Analytics, tags & anti-spam


| Service                         | Utilisé par               | Usage                                            | Facturation typique                 | Gratuit ? | Lien tarifs |
| ------------------------------- | ------------------------- | ------------------------------------------------ | ----------------------------------- | --------- | ----------- |
| **Google Analytics 4**          | Web, Admin (config)       | `G-1JK3P0CRJ0`                                   | Gratuit                             | ✅         |             |
| **Google Tag Manager**          | Web                       | `GT-5D93H5WL`                                    | Gratuit                             | ✅         |             |
| **Firebase Analytics**          | Web, Mobile               | `firebase_analytics` / `measurementId`           | Gratuit (quotas)                    | ⚠️        |             |
| **Vercel Analytics**            | Admin                     | `@vercel/analytics`                              | Selon plan Vercel                   | ✅         |             |
| **Vercel Speed Insights**       | Admin                     | `@vercel/speed-insights`                         | Selon plan Vercel                   | ✅         |             |
| **Facebook App Events / Pixel** | Mobile, Admin (optionnel) | `facebook_app_events`, `NEXT_PUBLIC_FB_PIXEL_ID` | Gratuit côté Meta ; coût pub séparé | ✅         |             |
| **reCAPTCHA Enterprise**        | Web, API                  | Formulaire contact + newsletter                  | Évaluations / mois (Google Cloud)   | ⚠️        |             |
| **Firebase Remote Config**      | Mobile                    | Feature flags / config distante                  | Gratuit (quotas)                    | ✅         |             |
| **Firebase Crashlytics**        | Mobile                    | Rapports de crash                                | Gratuit                             | ✅         |             |


---

## 11. Support client & chat


| Service          | Utilisé par        | Usage                                              | Facturation typique            | Gratuit ? | Lien tarifs |
| ---------------- | ------------------ | -------------------------------------------------- | ------------------------------ | --------- | ----------- |
| **Zoho SalesIQ** | Web, Admin, Mobile | Widget web + SDK Mobilisten (`salesiq_mobilisten`) | Plan Zoho par agent / visiteur | ✅         |             |


---

## 12. SEO, catalogue & intégrations Google


| Service                    | Utilisé par | Usage                                                         | Facturation typique         | Gratuit ? | Lien tarifs |
| -------------------------- | ----------- | ------------------------------------------------------------- | --------------------------- | --------- | ----------- |
| **Google Merchant Center** | API         | Export flux produits (`/google-merchant/export`)              | Gratuit (plateforme Google) | ✅         |             |
| **GitHub API**             | API         | Dispatch workflow `regenerate-sitemap` sur `africa-meals-web` | Gratuit (PAT)               | ✅         |             |
| **Google Fonts**           | Web, Mobile | Polices (Plus Jakarta Sans, etc.)                             | Gratuit                     | ✅         |             |


---

## 13. Éditeur & outils admin


| Service              | Utilisé par | Usage                                   | Facturation typique            | Gratuit ? | Lien tarifs                                                        |
| -------------------- | ----------- | --------------------------------------- | ------------------------------ | --------- | ------------------------------------------------------------------ |
| **TinyMCE**          | Admin       | Éditeur riche (blog, descriptions)      | Licence selon usage commercial | ⚠️        | [https://www.tiny.cloud/pricing/](https://www.tiny.cloud/pricing/) |
| **GraphQL (Apollo)** | API, Mobile | API `shopHome`, catalogue — self-hosted | Inclus dans Cloud Run          | -         |                                                                    |


---

## 14. Distribution mobile & OS


| Service                         | Utilisé par | Usage                                                              | Facturation typique | Gratuit ? | Lien tarifs |
| ------------------------------- | ----------- | ------------------------------------------------------------------ | ------------------- | --------- | ----------- |
| **Apple Developer Program**     | Mobile      | App Store, Sign in with Apple, Apple Pay, widgets, Live Activities | 99 $/an             | ❌         |             |
| **Google Play Console**         | Mobile      | Publication Android                                                | 25 $ one-time       | ❌         |             |
| **Universal Links / App Links** | Mobile, Web | `apple-app-site-association`, deep links `wise-eat://`             | —                   | ✅         |             |


---

## 15. Outils de développement (coût indirect)


| Service               | Utilisé par | Usage                       | Facturation            | Gratuit ? | Lien tarifs |
| --------------------- | ----------- | --------------------------- | ---------------------- | --------- | ----------- |
| **ngrok**             | API, WS     | Tunnels dev (`proxy.yml`)   | Plan ngrok si URL fixe | ✅         |             |
| **Cloudflare Tunnel** | Web         | `npm run tunnel` (dev)      | Gratuit (Cloudflare)   | ✅         |             |
| **PM2**               | API, WS     | Process manager local / VPS | Gratuit                | ✅         |             |


---

## Matrice de facturation prioritaire

Services à surveiller en priorité pour le budget :


| Priorité | Service                                | Postes de coût                                     | Gratuit ? | Lien tarifs |
| -------- | -------------------------------------- | -------------------------------------------------- | --------- | ----------- |
| **P0**   | **Stripe**                             | Transactions, Connect, abonnements, remboursements |           |             |
| **P0**   | **MongoDB Atlas**                      | Cluster, connexions (API + WS cumulées), stockage  |           |             |
| **P0**   | **Google Cloud Run**                   | `api` + `ws` — CPU × instances max                 |           |             |
| **P1**   | **Bird (SMS/WhatsApp)**                | Volume notifications pub + SMS vendeurs            |           |             |
| **P1**   | **Redis**                              | Instance + trafic BullMQ                           |           |             |
| **P1**   | **Mapbox**                             | Géocodage + tuiles (mobile + admin)                |           |             |
| **P1**   | **Firebase Storage**                   | Médias catalogue                                   |           |             |
| **P2**   | **Vercel**                             | Admin — bande passante, builds, Analytics          |           |             |
| **P2**   | **E-mail** (Gmail / MailerSend / Zoho) | Volume transactionnel + marketing                  |           |             |
| **P2**   | **Zoho SalesIQ**                       | Agents / conversations                             |           |             |
| **P2**   | **Google Maps API**                    | Si moteur Google activé côté admin/mobile          |           |             |
| **P2**   | **PayPal**                             | Transactions (si encore actif en prod)             |           |             |
| **P2**   | **reCAPTCHA Enterprise**               | Soumissions contact / newsletter                   |           |             |
| **P3**   | **Firebase Hosting**                   | Trafic `wise-eat.com`                              |           |             |
| **P3**   | **Cloud Functions Gen 2**              | Si déployé en parallèle de Cloud Run               |           |             |
| **P3**   | **MQTT (HiveMQ)**                      | Si broker cloud activé                             |           |             |
| **P3**   | **TinyMCE**                            | Licence commerciale éventuelle                     |           |             |
| **Fixe** | **Apple Developer**                    | 99 $/an                                            |           |             |


---

## Services internes (pas de facturation SaaS)


| Service                                                 | Gratuit ? | Lien tarifs |
| ------------------------------------------------------- | --------- | ----------- |
| **NestJS / Next.js / Flutter** — frameworks open source |           |             |
| **Socket.IO** — hébergé sur Cloud Run                   |           |             |
| **BullMQ** — orchestration sur Redis                    |           |             |
| **JWT / bcrypt** — auth maison                          |           |             |


---

## Recommandations pour l'audit billing

1. **Consolider GCP** : vérifier si l'API tourne sur Cloud Run **et** Cloud Functions (double facturation possible).
2. **MongoDB** : sommer les pools API (`MONGOOSE_MAX_POOL` ~~20) + WS (~~5) × nombre d'instances Cloud Run.
3. **Bird** : croiser volume SMS/WhatsApp avec `vendor-notification-billing` (re-facturation Stripe côté vendeur).
4. **Stripe** : distinguer frais plateforme vs **Connect transfers** vs abonnements vs crédit pub.
5. **Mapbox vs Google Maps** : un seul moteur actif en prod réduit les coûts carto.
6. **E-mail** : confirmer si prod utilise Gmail, Zoho ou MailerSend (3 chemins dans le code).

---

## Références dans le code


| Sujet                         | Fichier / doc                                 |
| ----------------------------- | --------------------------------------------- |
| Variables d'environnement API | `africa-meals-api/.env.example`               |
| Variables admin               | `africa-meals-admin/.env.example`             |
| Variables mobile              | `africa-meals-mobile/.env.example`            |
| Variables WS                  | `africa-meals-ws/.env.example`                |
| Bird SMS/WhatsApp             | `africa-meals-api/docs/BIRD_CHANNELS.md`      |
| Cloud Run API                 | `africa-meals-api/docs/CLOUD_RUN.md`          |
| Cloud Run WS                  | `africa-meals-ws/docs/CLOUD_RUN.md`           |
| Firebase Functions            | `africa-meals-api/docs/FIREBASE_FUNCTIONS.md` |
| E-mail SMTP                   | `africa-meals-api/docs/MAIL_SETUP.md`         |
| CI Firebase Hosting           | `africa-meals-web/docs/CI_FIREBASE.md`        |


---

*Dernière mise à jour : juin 2026*