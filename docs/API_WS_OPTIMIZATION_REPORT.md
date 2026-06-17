# Rapport d'optimisation — flux API & WebSocket

**Périmètre :** `africa-meals-api`, `africa-meals-ws`  
**Objectif :** accélérer, fiabiliser et réduire la charge — **sans retirer de fonctionnalité**  
**Date :** juin 2026  
**Référence :** [SSE_AND_EVENT_DRIVEN_IMPLEMENTATION.md](./SSE_AND_EVENT_DRIVEN_IMPLEMENTATION.md)

---

## Table des matières

1. [Synthèse exécutive](#1-synthèse-exécutive)
2. [Cartographie des flux](#2-cartographie-des-flux)
3. [Goulots d'étranglement](#3-goulots-détranglement-priorisés)
4. [Optimisations API](#4-optimisations-api)
5. [Optimisations WebSocket](#5-optimisations-websocket)
6. [Configuration recommandée](#6-matrice-configuration-recommandée)
7. [Plan d'action par phases](#7-plan-daction-par-phases)
8. [Métriques à instrumenter](#8-métriques-à-instrumenter)
9. [Objectifs de latence](#9-chaînes-de-latence--objectifs-post-optimisation)
10. [Risques si non optimisé](#10-risques-si-non-optimisé)
11. [Conclusion](#11-conclusion)

---

## 1. Synthèse exécutive

L'architecture actuelle superpose **trois canaux de notification** :

| Canal | Rôle | Latence typique |
|-------|------|-----------------|
| **Legacy MQTT** `africameals/internal/ws/*` | WS temps réel (commandes, chat, ads) | 15–80 ms |
| **Bus domaine** `africameals/domain/*` | EDA + handlers API + routage WS | 50 ms – plusieurs s |
| **SSE** `/api/sse/*` | Flux read-only admin/web | Long polling, heartbeats 20 s |

### Forces

- Fire-and-forget sur les dispatches WS legacy
- Cache infra 10 s sur les settings runtime
- Idempotence Redis sur domain events et Stripe
- Dédup in-flight checkout

### Faiblesses majeures

1. Handlers EDA **bloquants** dans le chemin `publish()` (webhook Stripe, fulfillment)
2. GPS livreur → **N requêtes Mongo populate** par tick
3. **Double/triple connexion** Redis et MQTT par process
4. WS **single-instance** (pas d'adapter Redis Socket.IO) → plafond horizontal
5. Bus domaine WS **incomplet** pour les commandes client (`order_staff_broadcast` seulement)
6. Travail **dupliqué** (audit statuts, loyalty, archive chat, ads legacy + domaine)

### Gain estimé (P0–P1)

| Métrique | Amélioration attendue |
|----------|----------------------|
| Latence webhook Stripe / GPS | −40 à −70 % |
| Charge Mongo / Redis | −30 % |
| Stabilité multi-réplica | Significative |

---

## 2. Cartographie des flux

### 2.1 Notification commande (legacy — `DOMAIN_EVENTS_ENABLED=false`)

```
OrdersService
  → findById + populate (lourd)
  → WsNotifyDispatchQueue.dispatch ×7 (client/vendor/agent/staff)
  → MQTT publish QoS1 internal/ws/*
  → ChatMqttSubscriber (WS)
  → BullMQ ws-internal (si Redis activé)
  → ChatGateway.processDispatch
  → Mobile / Admin (order:update / order:tracking)
```

**Amplification :** jusqu'à **7 dispatches MQTT** par changement de statut via `notifyPartiesOrderRealtimeFromDoc`.

**Fichiers clés :**

- `src/modules/orders/orders.service.ts`
- `src/modules/ws-notify/ws-notify-dispatch-queue.service.ts`
- `africa-meals-ws/src/chat/chat-mqtt-subscriber.service.ts`
- `africa-meals-ws/src/chat/chat-internal-dispatch-queue.service.ts`

### 2.2 Notification commande (EDA — `DOMAIN_EVENTS_ENABLED=true`, `WS_VIA_BUS=true`)

```
OrdersService
  → DomainEventPublisher.emit(order.*)
  → idempotency Redis
  → await handlers in-process (FCM, audit, etc.)   ← BLOQUANT
  → BullMQ domain-events → MQTT domain/*
  → DomainEventSubscriber (WS)
  → DomainEventWsRouter.route
  → order_staff_broadcast ONLY                    ← ÉCART CRITIQUE
```

**Écart critique :** avec `DOMAIN_EVENTS_WS_VIA_BUS=true`, le legacy WS est désactivé côté API, mais le routeur domaine n'envoie **pas** `order:update` / `order:tracking` aux salons `user:{id}` — seulement `orders:admin`.

**Fichiers clés :**

- `src/common/domain-events/domain-event-publisher.service.ts`
- `src/modules/domain-event-handlers/`
- `africa-meals-ws/src/domain-events/domain-event-ws-router.service.ts`

### 2.3 Webhook Stripe (EDA activé)

```
Stripe POST
  → handleWebhook
  → await domainEvents.emit()
      → PaymentFulfillmentHandler → fulfillFromDomainEvent() [SYNC]
      → order.paid handlers [SYNC]
      → enqueue MQTT
  → { received: true }
```

**Risque :** timeout webhook Stripe (~20–30 s), retry Stripe, double traitement malgré idempotence.

**Fichiers clés :**

- `src/modules/billing/billing.controller.ts`
- `src/modules/billing/stripe/stripe-grouped-checkout.service.ts`
- `src/modules/domain-event-handlers/payment-fulfillment.domain-event-handler.ts`

### 2.4 GPS livreur (hot path)

```
Mobile POST /location (~1 / 12 s)
  → pour chaque commande SHIPPED active:
      publishCourierPosition()
        → findById + populate store + user
        → emit order.tracking.updated (Redis idempotency + MQTT)
```

**Charge :** O(N commandes actives × fréquence GPS) requêtes lourdes.

**Fichiers clés :**

- `src/modules/delivery-agent/delivery-agent.service.ts`
- `src/modules/orders/orders.service.ts` (`publishCourierPosition`)

### 2.5 SSE (admin / web)

| Route | Usage | Fréquence |
|-------|-------|-----------|
| `/api/sse/search/reindex` | Progression réindexation search | Event-driven |
| `/api/sse/admin/system-health` | Santé MQTT + snapshot | Poll 7 s + heartbeat 20 s |
| `/api/sse/public/status` | Page status web | Idem |
| `/api/sse/admin/fleet` | Positions livreurs | Event-driven (si `agent.*` émis) |
| `/api/sse/admin/jobs/:jobId` | Jobs DB maintenance | Event-driven |
| `/api/sse/public/checkout/:sessionId` | Checkout Stripe | Event-driven |

**Fichiers clés :**

- `src/modules/sse-stream/`
- `africa-meals-admin/hooks/use-*-sse.ts`
- `africa-meals-admin/lib/sse-client.ts`

---

## 3. Goulots d'étranglement (priorisés)

### P0 — Critique latence / fiabilité

| # | Problème | Fichier / zone | Impact |
|---|----------|----------------|--------|
| 1 | **Handlers in-process await** avant bus | `domain-event-publisher.service.ts` | Webhook Stripe bloqué ; tout `emit()` attend FCM/fulfillment |
| 2 | **GPS N× populate** | `delivery-agent.service.ts` + `publishCourierPosition` | Pic Mongo ; latence mobile |
| 3 | **Routage domaine WS incomplet** | `domain-event-ws-router.service.ts` L77–102 | Clients mobile sans `order:update` si `WS_VIA_BUS=true` |
| 4 | **Pas de Redis adapter Socket.IO** | `chat.gateway.ts` / `main.ts` | Scale horizontal impossible ; emits perdus multi-réplica |

### P1 — Haute charge / latence

| # | Problème | Fichier / zone | Impact |
|---|----------|----------------|--------|
| 5 | **7 dispatches WS** par statut commande | `orders.service.ts` | 7× MQTT + 7× BullMQ |
| 6 | **Double client MQTT** (API + WS) | publisher + ws-notify + 2× WS subscribers | Connexions broker, mémoire |
| 7 | **Multiples connexions Redis** | BullMQ×N queues + idempotency ioredis | File descriptors, RAM |
| 8 | **Fulfillment Stripe séquentiel** multi-store | `stripe-grouped-checkout.service.ts` | Latence ∝ nb boutiques |
| 9 | **`readInfraSettings()`** répété | Chaque message MQTT/dispatch (cache 10 s) | Mongo sous charge |
| 10 | **Doublons ads** legacy + domaine | `AdDomainEventHandler` sans guard `wsViaBus` | 2× emits ad-manager |

### P2 — Efficacité / coût CPU

| # | Problème | Fichier / zone | Impact |
|---|----------|----------------|--------|
| 11 | **Double enregistrement** audit statuts | OrdersService + handler | 2× writes Mongo |
| 12 | **Loyalty + archive chat** en double à la livraison | OrdersService + handler | 2× appels (idempotents mais coûteux) |
| 13 | **Re-fetch order populate** après save | `confirmPickup`, handoff | Requête inutile |
| 14 | **SSE health `JSON.stringify`** pour dedup | `sse-stream-sources.service.ts` | CPU sur chaque tick 7 s |
| 15 | **Sweep O(n)** dedup domaine WS | `domain-event-ws-router.service.ts` | CPU sous flux élevé |
| 16 | **`fetchSockets()`** à chaque join chat | `chat.gateway.ts` | O(n) par conversation |
| 17 | **`archive_order_delivery` await** dans handler MQTT | `chat-mqtt-subscriber.service.ts` | Bloque le thread messages |

### P3 — Mémoire / ops

| # | Problème | Fichier / zone | Impact |
|---|----------|----------------|--------|
| 18 | **SSE Subjects** sans cleanup | checkout-session-sse, admin-job-progress | Fuite mémoire long terme |
| 19 | **Limite connexions SSE** in-memory par instance | `sse-stream.service.ts` | Inefficace multi-réplica |
| 20 | **Fleet SSE non alimenté** | pas d'émission `agent.*` API | SSE inutile ; polling 12 s reste seul flux |
| 21 | **`payment_intent.succeeded`** hors EDA | stripe webhook | Chemins asymétriques |

---

## 4. Optimisations API

> Toutes les optimisations ci-dessous **préservent les fonctionnalités existantes**.

### 4.1 Domain events & handlers

| Optimisation | Description | Gain attendu |
|--------------|-------------|--------------|
| **Publish async handlers** | `void runInProcessHandler()` ou worker dédié `domain-events-side-effects` ; webhook répond `{ received: true }` immédiatement | Webhook −80 % latence perçue |
| **Séparer publish vs process** | Aligner le code sur le commentaire « ne bloque pas le consommateur » | Fiabilité Stripe |
| **Throttle GPS domain events** | Max 1 `order.tracking.updated` / 2–5 s / agent ; batch positions | −90 % charge Mongo/MQTT/Redis |
| **Projection minimale GPS** | `findById` avec `.select()` sans double populate ; réutiliser coords en mémoire | −N requêtes lourdes/tick |
| **Idempotence GPS intelligente** | Clé dédup `agentId+orderId+roundedLatLng+window` au lieu d'UUID par tick | −charge Redis inutile |
| **Dédupliquer audit statuts** | Un seul appel `orderStatusEvents.record` (handler OU OrdersService) | −50 % writes audit |
| **Dédupliquer loyalty/archive** | Centraliser dans handler OU OrdersService, pas les deux | −2 ops Mongo/livraison |
| **Harmoniser PI webhook** | `payment_intent.succeeded` → même branche EDA que checkout | Cohérence + moins de code mort |
| **Guard ads `wsViaBus`** | Comme order/agent handlers | −50 % emits ads |

### 4.2 WsNotify & MQTT

| Optimisation | Description | Gain attendu |
|--------------|-------------|--------------|
| **Client MQTT unique** | Fusionner publisher domain + ws-notify (topics distincts) | −1 connexion/process |
| **Pool Redis partagé** | Une connexion ioredis pour BullMQ + idempotency | −3–6 connexions/process |
| **Infra settings singleton** | Service `@Injectable` partagé, TTL configurable 30–60 s | −Mongo reads |
| **Fusionner update+tracking** | Un seul message WS quand payload identique | −50 % dispatches commande |
| **Réutiliser order doc** | Passer document déjà chargé à `notifyParties*` | −1 populate/statut |
| **Bypass BullMQ latence-sensitive** | Env `WS_NOTIFY_LATENCY_SENSITIVE=order/tracking` → MQTT direct | −10–20 ms tracking |

### 4.3 Stripe fulfillment

| Optimisation | Description | Gain attendu |
|--------------|-------------|--------------|
| **Paralléliser stores** | `Promise.all` sur stores indépendants (garde idempotence par store) | −60 % checkout multi-boutiques |
| **Réponse webhook immédiate** | Fulfillment en queue après ack Stripe | Zero timeout webhook |
| **SSE checkout après ack** | Émettre SSE « processing » puis « complete » | UX web −perceived latency |

### 4.4 SSE

| Optimisation | Description | Gain attendu |
|--------------|-------------|--------------|
| **Checks health en parallèle** | `Promise.all` dans `runAllSystemHealthChecksInternal` | −70 % temps snapshot 120 s |
| **Hash léger vs JSON.stringify** | Comparer `status+checkedAt` ou hash FNV | −CPU tick 7 s |
| **Cleanup Subjects** | TTL + `complete()` sur checkout/jobs terminés | Mémoire stable |
| **Limite SSE globale** | Compteur process + Redis optionnel multi-réplica | Protection DoS |
| **Alimenter fleet** | Émettre `agent.*` depuis DeliveryAgentService | SSE-005 utile ; −polling admin |

### 4.5 MongoDB

| Optimisation | Description | Gain attendu |
|--------------|-------------|--------------|
| **Index hot paths** | Vérifier index `{ assigned_delivery_user, status, shouldShip }` | GPS lookup −ms |
| **Pool sizing doc** | API 20 + WS 5 × instances ≤ limite Atlas | Éviter `WaitQueueTimeout` |
| **Lean + select** | Handlers n'ont pas besoin du populate complet user.addresses | −bande passante |

---

## 5. Optimisations WebSocket

### 5.1 Infrastructure

| Optimisation | Description | Gain attendu |
|--------------|-------------|--------------|
| **`@socket.io/redis-adapter`** | Rooms partagées entre instances Cloud Run | Scale horizontal fiable |
| **Fusionner 2 subscribers MQTT** | Un client, topics `internal/ws/*` + `domain/#` | −50 % connexions broker WS |
| **Cache infra partagé** | Entre legacy + domain subscribers + dispatch | −2 Mongo reads/message |
| **Archive chat async** | Enqueue job au lieu de `await` dans MQTT handler | MQTT non bloqué |

### 5.2 Gateway & Socket.IO

| Optimisation | Description | Gain attendu |
|--------------|-------------|--------------|
| **Config serveur explicite** | `transports: ['websocket']`, `pingInterval: 25000`, `pingTimeout: 20000` | Moins polling HTTP |
| **Éviter `fetchSockets()`** | Compteur join ou trust `socket.data.userId` | Join chat −O(n) |
| **Compléter DomainEventWsRouter** | `order.*` → dispatch `order_update` + `order_tracking` par party (metadata API) | Parité legacy + perf bus |
| **Dedup unifiée** | Redis SET `ws:seen:{eventId}` TTL 60 s legacy + domaine | Anti double QoS1 |
| **Sweep `seen` intervalle** | `setInterval` 30 s au lieu de par event | CPU stable |

### 5.3 Dispatch interne

| Optimisation | Description | Gain attendu |
|--------------|-------------|--------------|
| **Direct emit si charge faible** | Bypass BullMQ si queue depth < seuil | −15 ms médiane |
| **Concurrency worker tunable** | 40 → mesurer ; peut saturer CPU single core | Throughput vs latence |
| **Batch inbox refresh** | Dédupliquer `userId` sur rafales archive | −N dispatches |

---

## 6. Matrice configuration recommandée

### 6.1 Production performante

```env
# --- EDA : async side-effects, WS via bus complet ---
DOMAIN_EVENTS_ENABLED=true
DOMAIN_EVENTS_WS_VIA_BUS=true   # après fix routage WS client

# --- Infra cache (réduire Mongo) ---
INFRA_RUNTIME_SETTINGS_CACHE_MS=30000

# --- Redis pool (documenter et sommer instances) ---
MONGOOSE_MAX_POOL=15              # API

# --- BullMQ tuning ---
DOMAIN_EVENTS_QUEUE_CONCURRENCY=20
WS_INTERNAL_DISPATCH_CONCURRENCY=30
WS_NOTIFY_QUEUE_ATTEMPTS=3

# --- SSE ---
SSE_HEARTBEAT_MS=25000
SSE_MAX_CONNECTIONS_PER_USER=3

# --- MQTT ---
MQTT_QOS=1                        # 0 pour tracking GPS only (feature flag)
```

### 6.2 Mode latence minimale (single instance / dev)

```env
DOMAIN_EVENTS_ENABLED=false         # legacy WS direct, handlers off
# OU Redis manager off → MQTT direct sans BullMQ hop
```

### 6.3 Cloud Run / déploiement

| Paramètre | Recommandation |
|-----------|----------------|
| Timeout HTTP API | ≥ 60 s (fulfillment si pas encore async) |
| Timeout SSE | ≥ 3600 s |
| Min instances WS | ≥ 1 (cold start Socket.IO) |
| CPU WS | ≥ 1 vCPU si concurrency 40 |
| Sticky sessions | Requis sans Redis adapter |

---

## 7. Plan d'action par phases

### Phase A — Quick wins (1–3 jours, risque faible)

| # | Action | Fichiers impactés |
|---|--------|-------------------|
| 1 | Throttle + projection minimale GPS | `delivery-agent.service.ts`, `orders.service.ts` |
| 2 | `void runInProcessHandler` + webhook Stripe async | `domain-event-publisher.service.ts`, `billing.controller.ts` |
| 3 | Guard `wsViaBus` sur ads | `ad.domain-event-handler.ts` |
| 4 | Dédupliquer audit / loyalty / archive | `orders.service.ts`, handlers order |
| 5 | Infra settings cache 30 s + singleton | `ws-notify-dispatch-queue.service.ts`, subscribers WS |
| 6 | SSE health : `Promise.all` + hash dedup | `sse-stream-sources.service.ts` |
| 7 | Archive chat → queue BullMQ | `chat-mqtt-subscriber.service.ts` |

**KPI cibles :** p95 webhook < 500 ms ; p95 GPS < 100 ms ; −30 % ops Mongo/heure

### Phase B — Fiabilité & parité (3–7 jours)

| # | Action | Fichiers impactés |
|---|--------|-------------------|
| 1 | Compléter `DomainEventWsRouter` (order client/vendor/agent) | `domain-event-ws-router.service.ts` |
| 2 | Émettre `agent.*` depuis DeliveryAgentService | `delivery-agent.service.ts` |
| 3 | Client MQTT unique (API + WS) | publisher, ws-notify, subscribers |
| 4 | Pool Redis partagé | modules BullMQ + idempotency |
| 5 | Fusion update+tracking WS legacy | `orders.service.ts` |
| 6 | Paralléliser fulfillment multi-store | `stripe-grouped-checkout.service.ts` |

**KPI cibles :** parité mobile/admin legacy vs EDA ; zero timeout webhook

### Phase C — Scale horizontal (1–2 semaines)

| # | Action |
|---|--------|
| 1 | `@socket.io/redis-adapter` |
| 2 | Limite SSE distribuée (Redis) |
| 3 | Cleanup Subjects SSE |
| 4 | Métriques Prometheus (§8) |
| 5 | Load test k6 : 500 conn WS, 50 GPS/s, 100 commandes/min |

**KPI cibles :** linear scale 2–4 instances WS ; error rate < 0.1 %

---

## 8. Métriques à instrumenter

| Métrique | Seuil alerte | Où |
|----------|--------------|-----|
| `domain_event_publish_duration_ms` | p95 > 100 ms | API publisher |
| `domain_handler_duration_ms{type}` | p95 > 500 ms | Handlers |
| `stripe_webhook_duration_ms` | p95 > 2000 ms | Billing controller |
| `gps_publish_courier_duration_ms` | p95 > 150 ms | DeliveryAgent |
| `ws_mqtt_message_lag_ms` | p95 > 100 ms | WS subscriber |
| `ws_dispatch_queue_depth` | > 1000 | BullMQ |
| `mongo_pool_wait_ms` | > 50 ms | Mongoose |
| `mqtt_connected` | 0 | API + WS |
| `sse_active_connections` | > 500/instance | SSE service |
| `domain_ws_duplicate_dropped` | info | Router |

---

## 9. Chaînes de latence — objectifs post-optimisation

| Flux | Aujourd'hui (estimé) | Cible |
|------|----------------------|-------|
| Changement statut → WS client (legacy) | 50–150 ms | 30–80 ms |
| Changement statut → WS client (EDA) | incomplet / 100–200 ms | 40–90 ms |
| Webhook Stripe → ack | 2–15 s | < 300 ms |
| Webhook Stripe → commande payée | 2–15 s | 1–5 s (async OK) |
| GPS → WS tracking | 100–500 ms × N | 50–120 ms total |
| SSE health tick | 200 ms–2 s | < 500 ms |
| Chat message → client | 50–200 ms | 30–100 ms |

---

## 10. Risques si non optimisé

| Risque | Probabilité | Conséquence |
|--------|-------------|-------------|
| Timeout webhook Stripe | Moyenne (EDA ON) | Retries, doubles charges, support |
| Saturation Mongo GPS | Haute (fleet actif) | `WaitQueueTimeout`, lenteur globale |
| Perte events WS multi-réplica | Haute (prod scale) | Commandes « fantômes » côté mobile |
| Double emits ads | Moyenne (EDA ON) | UI admin clignotante, charge inutile |
| Fuite mémoire SSE/checkout | Basse (long uptime) | OOM instance API |
| Incohérence EDA vs legacy | Haute si `WS_VIA_BUS=true` | Régression fonctionnelle mobile |

---

## 11. Conclusion

Le stack API/WS est **fonctionnellement riche** mais **architecturalement en transition** (legacy MQTT ↔ bus domaine ↔ SSE). Les plus gros gains performance/fiabilité viennent de :

1. **Désynchroniser** les handlers lourds du chemin HTTP/webhook
2. **Réduire l'amplification** (7 dispatches, N populate GPS, doubles connexions)
3. **Compléter le routage domaine WS** avant d'imposer `WS_VIA_BUS=true` en prod
4. **Préparer le scale horizontal** WS (Redis adapter)

Aucune feature ne doit être supprimée : il s'agit de **réorganiser le travail** (async, batch, cache, dedup, parité de payloads) pour atteindre un système **rapide, fiable et efficient**.

---

## Annexe — Écarts doc vs code (juin 2026)

| Ticket | Statut réel | Action optimisation |
|--------|-------------|---------------------|
| **EDA-007** | Handlers prêts ; pas d'émission `agent.*` depuis API | Brancher DeliveryAgentService |
| **EDA-008** | Handlers prêts ; pas d'émission depuis AdsService | Guard + émission unique |
| **SSE-006** | Route SSE OK ; pas de `clearTablesAsync` branché | Brancher panel DB |
| **SSE-007** | JS + route API ; pas de page HTML checkout web | Créer page checkout |
| **EDA-003/005** | Router domaine → staff broadcast seulement | Compléter routage client |

---

*Rapport généré par analyse statique du code. Validation recommandée par profiling (Clinic.js, MongoDB profiler, Stripe dashboard webhook latency) avant/après Phase A.*
