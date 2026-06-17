# Rapport — appels API en polling (clients AfrikaMeals)

> **Date :** 17 juin 2026  
> **Périmètre :** applications clientes (`africa-meals-admin`, `africa-meals-mobile`, `africa-meals-web`).  
> **Hors scope :** crons serveur NestJS, jobs BullMQ, heartbeats SSE (pas des polls HTTP classiques).

Ce document recense les endroits où le code **relance périodiquement des requêtes HTTP** vers l’API (ou le WS en REST), ainsi que les **fallbacks de polling** lorsqu’un flux SSE/WebSocket est indisponible.

---

## Synthèse

| Application | Polls actifs (intervalle) | Fallback poll (si SSE/WS KO) | Déjà migré SSE/WS (poll désactivé si live) |
|-------------|---------------------------|------------------------------|--------------------------------------------|
| **Admin**   | 6 zones                   | 2                            | 3 (fleet, system-health, reindex)          |
| **Mobile**  | 5 zones                   | 0                            | Suivi commande (WS + poll complémentaire)  |
| **Web**     | 1 (status public)         | 1                            | Checkout (SSE principal)                   |

**Charge la plus sensible (écrans ouverts longtemps) :**

1. Admin **Suivi livraisons** — `GET /orders` + `GET /dashboard/livreurs` toutes les **30 s**
2. Admin **Stats requêtes** — `GET /request-stats/admin` (API + WS) toutes les **10 s** si auto-refresh activé
3. Admin **Santé système** — N × `POST …/system-health/{key}/run` toutes les **5–30 s** si ping activé
4. Mobile **Suivi commande** — `GET /orders/:id/live-tracking` toutes les **10 s** (complément WS)
5. Admin **Livreurs** — fallback `GET /dashboard/livreurs` + `GET /orders` toutes les **60 s** si SSE fleet mort

---

## Légende

| Colonne | Signification |
|---------|----------------|
| **Intervalle** | Délai fixe entre deux appels (ou fenêtre burst) |
| **Déclencheur** | Page/écran monté, toggle utilisateur, etc. |
| **Arrêt** | Démontage composant, onglet caché, condition métier |
| **Alternative** | Mécanisme temps réel préféré (SSE, WS) |

---

## 1. Admin (`africa-meals-admin`)

### 1.1 Livraisons — tableau de bord livreurs

| Champ | Valeur |
|-------|--------|
| **Fichier** | `app/(default)/livraisons/livreurs/page.tsx` |
| **Intervalle** | **60 000 ms** (`LIVREURS_POLL_MS`) |
| **Condition** | Uniquement si **SSE fleet inactive** (`fleetSseLiveRef.current === false`) |
| **Déclencheur** | Page ouverte (admin ou vendeur avec accès livraisons) |

**Appels API (batch `reloadAll`) :**

| Méthode | Route | Rôle |
|---------|-------|------|
| `GET` | `/dashboard/livreurs` | Liste livreurs, positions, statuts |
| `GET` | `/orders?limit=150` | Commandes en attente d’assignation |

**Temps réel préféré :** `useFleetSse` → `GET /sse/admin/fleet` (snapshot agents GPS/présence).  
**Complément WS :** `useWsOrderTracking` → debounce **450 ms** puis `reloadAll` (événementiel, pas intervalle).

---

### 1.2 Livraisons — suivi en temps réel

| Champ | Valeur |
|-------|--------|
| **Fichier** | `app/(default)/livraisons/suivi/page.tsx` |
| **Intervalle** | **30 000 ms** |
| **Déclencheur** | Montage page |
| **Arrêt** | Démontage (`clearInterval`) |

**Appels API (`reloadCommandes`) :**

| Méthode | Route | Rôle |
|---------|-------|------|
| `GET` | `/orders?limit=100` | Commandes actives |
| `GET` | `/dashboard/livreurs` | Livreurs pour carte / ETA |
| `GET` | `/stores/vendor/summary` | Ancrage carte (vendeur uniquement) |

> Pas de SSE sur cette page aujourd’hui — **polling pur**.

---

### 1.3 Paramètres — stats requêtes (API + WS)

| Champ | Valeur |
|-------|--------|
| **Fichier** | `components/admin/request-stats-panel.tsx` |
| **Intervalle** | **10 000 ms** (`REFRESH_MS`) |
| **Condition** | Toggle **« Rafraîchir »** (`autoRefresh === true`) |
| **Déclencheur** | Panneau stats ouvert avec auto-refresh |

**Appels :**

| Méthode | Route | Service |
|---------|-------|---------|
| `GET` | `/request-stats/admin` | africa-meals-**api** |
| `GET` | `/api/request-stats/admin` | africa-meals-**ws** |
| `GET` | `/dashboard/top-stores/today` | Chargement initial noms boutiques (pas en intervalle) |

---

### 1.4 Paramètres — santé système (ping manuel)

| Champ | Valeur |
|-------|--------|
| **Fichier** | `components/admin/system-health-panel.tsx` |
| **Intervalle** | **5 / 10 / 15 / 30 s** (choix admin, défaut **10 s**) |
| **Condition** | Toggle **« Ping automatique »** (`pingEnabled`) |
| **Déclencheur** | Panneau santé système |

**Appels par cycle (`runAllChecks`) — un POST par check configuré :**

| Méthode | Route |
|---------|-------|
| `POST` | `/db-maintenance/admin/system-health/{key}/run` |

**Temps réel préféré :** `useSystemHealthSse` → `/sse/admin/system-health` (snapshots + MQTT). Le ping intervalle reste un **outil de diagnostic manuel**.

---

### 1.5 Finances — versements Stripe Connect

| Champ | Valeur |
|-------|--------|
| **Fichier** | `app/(alternative)/finances/versements/page.tsx` |
| **Intervalle** | **25 000 ms** |
| **Condition** | Vendeur onboardé (`isVendor && onboarded`) |
| **Déclencheur** | Page versements ouverte |

**Appels (`loadStatus`) :**

| Méthode | Route |
|---------|-------|
| `GET` | `/billing/stripe/connect/status` |

**Temps réel préféré :** `useWsStripeConnectStatus` → événement WS `stripe:connect:status` (pas de poll si WS reçoit les mises à jour).

---

### 1.6 Auth — récupération de session

| Champ | Valeur |
|-------|--------|
| **Fichier** | `components/dashboard-auth-guard.tsx` |
| **Intervalle** | **4 000 ms** |
| **Condition** | Token stocké mais `user` pas encore hydraté (`sessionRecovering`) |
| **Arrêt** | Dès que `user` est défini |

**Appels :**

| Méthode | Route |
|---------|-------|
| `POST` | `/auth/refresh` puis `/auth/me` si besoin |

> Burst court au démarrage — pas un poll de fond sur toute l’app.

---

### 1.7 Moteur de recherche — réindexation (fallback SSE)

| Champ | Valeur |
|-------|--------|
| **Fichiers** | `hooks/use-search-reindex-sse.ts`, `app/(default)/settings/search-engine/search-engine-panel.tsx` |
| **Intervalle fallback** | **10 000 ms** |
| **Condition** | SSE `/sse/search/reindex` en erreur |
| **Déclencheur** | Réindexation en cours (`enabled`) |

**Appel fallback :**

| Méthode | Route |
|---------|-------|
| `GET` | `/platform/search-settings/reindex/status` |

**Flux principal :** SSE (pas de poll tant que la connexion tient).

---

### 1.8 Abonnement vendeur — confirmation checkout (fallback unique)

| Champ | Valeur |
|-------|--------|
| **Fichier** | `app/(default)/settings/subscription/subscription-panel.tsx` |
| **Délai fallback** | **12 000 ms** (timeout unique, pas intervalle) |
| **Condition** | Retour Stripe avec `session_id` dans l’URL |

**Appels :**

| Méthode | Route | Rôle |
|---------|-------|------|
| SSE | `/sse/public/checkout/:sessionId` | Principal |
| `POST` | *(confirm subscription checkout)* | Si SSE n’a pas confirmé à T+12s |

---

### 1.9 Non-polling (événementiel — référence)

Ces composants appellent l’API sur **événement** (WS, visibilité, debounce), **sans** `setInterval` :

| Composant | Routes typiques | Déclencheurs |
|-----------|-----------------|--------------|
| `components/header-support-chat.tsx` | WS `GET /api/chat/conversations` ou messages support | `chat:inbox`, focus onglet |
| `components/dropdown-notifications.tsx` | `GET /stores/vendor/notifications` | `inbox:feed:refresh`, visibilité |
| `lib/ws-chat-presence.ts` | WS `join` (pas REST poll) | Connexion socket + liste conversations |

---

## 2. Mobile (`africa-meals-mobile`)

### 2.1 Suivi commande client / vendeur (carte)

| Champ | Valeur |
|-------|--------|
| **Fichier** | `lib/pages/shop/order_pickup_tracking_page.dart` |
| **Intervalle** | **10 s** (`_livePollTimer`) |
| **Complément UI** | **2 s** (`_liveTickTimer`) — interpolation locale, **pas d’API** |
| **Condition** | `_liveTrackingActive` |
| **Déclencheur** | Écran suivi ouvert |

**Appel :**

| Méthode | Route |
|---------|-------|
| `GET` | `/orders/:id/live-tracking` |

**Temps réel :** `OrderTrackingHub` / WS `order:tracking` — le poll reste un **filet de sécurité** si le WS rate un tick.

---

### 2.2 Carte livreur — itinéraires actifs

| Champ | Valeur |
|-------|--------|
| **Fichier** | `lib/pages/modes/delivery/delivery_map_performance_page.dart` |
| **Intervalle** | **8 s** (`_activeLivePollTimer`) |
| **Condition** | Commandes actives + onglet carte visible |

**Appels :**

| Type | Cible | Note |
|------|-------|------|
| **Externe** | API **Mapbox** directions (`fetchMapboxDrivingRoute`) | Pas l’API AfrikaMeals |
| Ponctuel | `GET /orders/:id` | Ouverture détail carte uniquement |

---

### 2.3 Panier — attente vidage post-paiement

| Champ | Valeur |
|-------|--------|
| **Fichier** | `lib/domaine/shop/cart_badge_controller.dart` |
| **Intervalle** | **500 ms** |
| **Durée** | Max **12 tentatives** (~6 s burst) |
| **Déclencheur** | Retour paiement réussi (webhook panier vide) |

**Appel :**

| Méthode | Route |
|---------|-------|
| `GET` | Panier multi-boutiques via `StoreRepository.fetchStore` |

---

### 2.4 Notifications pub in-app

| Champ | Valeur |
|-------|--------|
| **Fichier** | `lib/push/ad_promo_inbox_watcher.dart` |
| **Intervalle** | **Aucun timer fixe** — poll **à la demande** |
| **Déclencheurs** | Login, FCM, signal inbox WS, retour foreground (debounce) |

**Appel :**

| Méthode | Route |
|---------|-------|
| `GET` | `/notifications/inbox?limit=12` |

---

### 2.5 Restaurants à proximité (foreground)

| Champ | Valeur |
|-------|--------|
| **Fichier** | `lib/push/nearby_restaurant_monitor.dart` |
| **Intervalle** | **5 min** (`NearbyRestaurantLimits.minCheckInterval`) |
| **Complément** | `Geolocator.getPositionStream` (déplacement **> 150 m**) |
| **Condition** | App au premier plan, mode client, permissions OK |

**Appel :**

| Méthode | Route |
|---------|-------|
| `GET` | `/search?searchContent=stores&…` (géolocalisé) |

---

### 2.6 Télémétrie ads targeting

| Champ | Valeur |
|-------|--------|
| **Fichier** | `lib/data/ads_targeting_tracker.dart` |
| **Intervalle** | **10 s** (flush batch) |
| **Condition** | File d’événements non vide + consentement |

**Appel :**

| Méthode | Route |
|---------|-------|
| `POST` | `/ads/targeting/events` |

---

### 2.7 Non-polling (UI / timers sans API)

| Fichier | Intervalle | Rôle |
|---------|------------|------|
| `home.dart` | 3–5 s | Carrousels offres / boutiques |
| `home_search_bar.dart` | 140 ms | Animation placeholder |
| `order_ongoing_header_rotator.dart` | configurable | Rotation bannière commande |
| `login_2fa_page.dart`, `verify.dart`, `reset.dart` | 1 s | Compte à rebours OTP |

---

## 3. Web public (`africa-meals-web`)

### 3.1 Page statut services

| Champ | Valeur |
|-------|--------|
| **Fichier** | `public/js/status-page.js` |
| **Intervalle fallback** | **60 000 ms** (`REFRESH_MS`) |
| **Condition** | SSE `/sse/public/status` indisponible ou en erreur |
| **Déclencheur** | Page statut chargée |

**Probes HTTP par service (fallback `runProbe`) :**

| Service | Endpoint testé |
|---------|----------------|
| API | `{apiBase}/health` |
| WS | `{wsBase}/api/health` |
| Admin | `{adminBase}/` (HEAD) |
| Site | `https://wise-eat.com/` |

**Flux principal :** SSE public (pas de poll si EventSource OK).

---

### 3.2 Checkout success (statique)

| Champ | Valeur |
|-------|--------|
| **Fichier** | `public/js/checkout-success.js` |
| **Polling** | **Non** — SSE `/sse/public/checkout/:sessionId` |
| **Timeout UX** | **12 s** message utilisateur (pas d’appel API supplémentaire) |

---

### 3.3 Non-polling

| Fichier | Note |
|---------|------|
| `public/js/product-page.js` | `setInterval` 4,5 s — carousel images **local** |
| `public/index.html` | Horloge UI 1 s |

---

## 4. Matrice consolidée (polls HTTP AfrikaMeals actifs)

| # | App | Écran / module | Intervalle | Routes API | SSE/WS préféré |
|---|-----|----------------|------------|------------|----------------|
| 1 | Admin | Livreurs | 60 s (fallback) | `/dashboard/livreurs`, `/orders` | `/sse/admin/fleet` |
| 2 | Admin | Suivi livraisons | 30 s | `/orders`, `/dashboard/livreurs`, `/stores/vendor/summary` | — |
| 3 | Admin | Stats requêtes | 10 s (opt-in) | `/request-stats/admin` ×2 | — |
| 4 | Admin | Santé système | 5–30 s (opt-in) | `/db-maintenance/admin/system-health/*/run` | `/sse/admin/system-health` |
| 5 | Admin | Versements Stripe | 25 s | `/billing/stripe/connect/status` | WS `stripe:connect:status` |
| 6 | Admin | Auth guard | 4 s (burst) | `/auth/refresh`, `/auth/me` | — |
| 7 | Admin | Réindex search | 10 s (fallback SSE) | `/platform/search-settings/reindex/status` | `/sse/search/reindex` |
| 8 | Mobile | Suivi commande | 10 s | `/orders/:id/live-tracking` | WS `order:tracking` |
| 9 | Mobile | Panier post-paiement | 500 ms ×12 | panier (`fetchStore`) | — |
| 10 | Mobile | Ads targeting | 10 s | `POST /ads/targeting/events` | — |
| 11 | Mobile | Restaurants proches | 5 min (+ GPS) | `GET /search` | — |
| 12 | Web | Statut public | 60 s (fallback) | `/health`, probes | `/sse/public/status` |

---

## 5. Recommandations (priorité)

### Haute — charge continue en production

1. **Suivi livraisons admin (30 s)** — brancher `useWsOrderTracking` / SSE commandes comme sur la page Livreurs, ou fusionner avec le flux fleet.
2. **Stats requêtes (10 s)** — garder opt-in ; documenter l’impact en prod si plusieurs admins laissent l’auto-refresh actif.
3. **Mobile live-tracking (10 s)** — réduire ou désactiver le poll quand `OrderTrackingHub` est connecté et a reçu un tick récent.

### Moyenne — déjà partiellement optimisé

4. **Livreurs 60 s fallback** — acceptable tant que SSE fleet est stable ; monitorer `fleetSseLiveRef`.
5. **Versements 25 s** — s’appuyer uniquement sur WS une fois le retour onboarding validé en prod.

### Basse — burst court ou métier léger

6. **Cart badge 500 ms** — burst borné, acceptable.
7. **Auth guard 4 s** — uniquement au cold start session.
8. **Nearby restaurants 5 min** — contraintes anti-spam déjà en place.

---

## 6. Maintenance de ce document

Lors de l’ajout d’un `setInterval` / `Timer.periodic` qui appelle `apiFetch`, `dio.get/post`, ou `fetch` :

1. Documenter la route, l’intervalle et la condition d’arrêt dans ce fichier.
2. Préférer **SSE ou WS** pour les écrans « temps réel » (pattern déjà utilisé : fleet, system-health, reindex, checkout).
3. Si un fallback poll existe, indiquer explicitement **quand le poll est désactivé** (ex. `fleetSseLiveRef`).

**Recherche utile dans le repo :**

```bash
# Admin / Web
rg 'setInterval|refetchInterval|pollRef|fallbackTimer' africa-meals-admin africa-meals-web

# Mobile
rg 'Timer\.periodic|pollInterval|_livePoll' africa-meals-mobile/lib
```

---

*Généré à partir de l’état du code au 17/06/2026.*
