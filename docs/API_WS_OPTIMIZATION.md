# Optimisation API & WebSocket — Wise Eat

**Date :** 15 juin 2026  
**Périmètre :** `africa-meals-api`, `africa-meals-ws`  
**Objectif :** rendre les flux **rapides, fiables, efficaces et ultra performants** — **sans retirer ni désactiver de fonctionnalité**  
**Documents liés :** [SSE_AND_EVENT_DRIVEN_IMPLEMENTATION.md](./SSE_AND_EVENT_DRIVEN_IMPLEMENTATION.md), [SECURITY_AUDIT.md](./SECURITY_AUDIT.md)

---

## Score de maturité performance (estimation)

| Domaine | Score | Niveau |
|---------|-------|--------|
| **Chemin legacy WS (MQTT direct)** | 72/100 | Acceptable |
| **Bus domaine (EDA)** | 58/100 | À optimiser |
| **SSE (admin / web)** | 65/100 | Acceptable |
| **Scale horizontal WS** | 35/100 | Insuffisant |
| **Hot paths (GPS, Stripe webhook)** | 45/100 | Critique |

**Verdict :** l’architecture est fonctionnellement complète mais souffre d’**amplification de travail** (N dispatches, N populate Mongo, handlers synchrones) et d’une **transition EDA incomplète** côté routage WS client. Les optimisations proposées réorganisent le travail (async, batch, cache, dedup) sans supprimer de feature.

---

## 1. Synthèse exécutive

### 1.1 Trois canaux de notification coexistent

| Canal | Topics / routes | Usage |
|-------|-----------------|-------|
| **Legacy MQTT** | `africameals/internal/ws/*` | WS temps réel (commandes, chat, ads, inbox) |
| **Bus domaine** | `africameals/domain/*` | EDA, handlers API, routage WS via subscriber |
| **SSE** | `/api/sse/*` | Flux read-only (health, reindex, fleet, jobs, checkout) |

### 1.2 Forces actuelles

- Dispatches WS legacy en **fire-and-forget** (`void dispatch`) — ne bloque pas la requête HTTP.
- **Idempotence Redis** sur domain events et webhooks Stripe.
- **Cache infra** 10 s (`INFRA_RUNTIME_SETTINGS_CACHE_MS`) avant lecture Mongo des toggles Redis/MQTT.
- **Fallback** MQTT → HTTP direct → BullMQ selon infra disponible.
- **Dedup** in-flight checkout et événements domaine WS (Map TTL 60 s).

### 1.3 Faiblesses majeures

| # | Problème | Impact |
|---|----------|--------|
| 1 | Handlers EDA **await** avant publication bus | Webhook Stripe bloqué 2–15 s |
| 2 | GPS → **N× `publishCourierPosition`** avec populate lourd | Saturation Mongo sous fleet actif |
| 3 | **7 dispatches WS** par changement statut commande | 7× MQTT + 7× BullMQ |
| 4 | **Double client MQTT** (legacy + domain) par process WS | Connexions broker, RAM |
| 5 | **Pas de Redis adapter Socket.IO** | Scale horizontal WS impossible |
| 6 | Routage domaine `order.*` → **staff only** | Régression mobile si `WS_VIA_BUS=true` |
| 7 | Travail **dupliqué** (audit, loyalty, archive, ads) | Charge Mongo/CPU inutile |

### 1.4 Gains estimés (Phases A + B)

| Métrique | Avant | Cible |
|----------|-------|-------|
| p95 webhook Stripe (ack) | 2–15 s | < 300 ms |
| p95 GPS → WS tracking | 100–500 ms × N | 50–120 ms total |
| Dispatches WS / changement statut | jusqu’à 7 | 3–4 |
| Connexions Redis / process API | 4–8 | 1–2 |
| Charge Mongo GPS (fleet 20 agents) | ~100 req/s | ~5–10 req/s |

---

## 2. Cartographie des flux

### 2.1 Changement statut commande — mode legacy

`DOMAIN_EVENTS_ENABLED=false`

```
OrdersService
  → findById + populate (store, user, addresses)
  → notifyPartiesOrderRealtimeFromDoc()
      → notifyCustomerOrderRealtime (client)        [update + tracking]
      → notifyCustomerOrderUpdate/Tracking (vendor) [×2]
      → notifyCustomerOrderUpdate/Tracking (agent)  [×2]
      → notifyStaffOrderBroadcast                   [×1]
  → WsNotifyDispatchQueue (× jusqu'à 7)
      → MQTT QoS1 internal/ws/*
      → (optionnel) BullMQ ws-internal
  → ChatMqttSubscriber (WS)
      → ChatInternalDispatchQueue
      → ChatGateway → rooms user:{id}, orders:admin
```

**Fichiers clés :**

- `src/modules/orders/orders.service.ts` — `notifyPartiesOrderRealtimeFromDoc` (L2474)
- `src/modules/ws-notify/ws-notify-dispatch-queue.service.ts`

### 2.2 Changement statut commande — mode EDA

`DOMAIN_EVENTS_ENABLED=true`, `DOMAIN_EVENTS_WS_VIA_BUS=true`

```
OrdersService
  → OrderDomainBridgeService.emit({ type: 'order.*' })
  → DomainEventPublisher.publish()
      → idempotency Redis (tryClaim)
      → await runInProcessHandler()     ← BLOQUANT
      → BullMQ domain-events OU MQTT direct
  → DomainEventSubscriber (WS)
      → DomainEventWsRouterService.route()
          → order.* → dispatch('order_staff_broadcast') ONLY
          → order.tracking.updated → order_staff_broadcast ONLY
```

**Écart critique :** le routeur domaine n’envoie **pas** `order:update` / `order:tracking` aux salons `user:{customerId}` — seulement `orders:admin`. Avec `WS_VIA_BUS=true`, le legacy API est court-circuité → **clients mobile sans notifications commande**.

**Fichiers clés :**

- `src/common/domain-events/domain-event-publisher.service.ts` (L177)
- `africa-meals-ws/src/domain-events/domain-event-ws-router.service.ts` (L77–102)

### 2.3 Webhook Stripe (EDA activé)

```
POST /billing/stripe/webhook
  → handleWebhook()
  → await domainEvents.emit('payment.checkout.completed')
      → PaymentFulfillmentHandler (SYNC)
          → fulfillFromDomainEvent() — création commandes multi-store
      → OrderDomainEventHandler — FCM, audit, etc.
      → enqueue MQTT / BullMQ
  → { received: true }
```

**Risque :** Stripe timeout (~20–30 s) → retries → charge double malgré idempotence.

### 2.4 GPS livreur (hot path)

```
POST /delivery-agent/location (~1 req / 12 s / agent)
  → pour chaque commande SHIPPED active de l'agent:
      publishCourierPosition(orderId, lat, lng)
        → findById + populate store + user  ← LOURD
        → emit order.tracking.updated (EDA)
          OU notifyPartiesOrderRealtimeFromDoc (legacy)
```

**Charge :** O(N commandes actives × fréquence GPS).

**Fichiers clés :**

- `src/modules/delivery-agent/delivery-agent.service.ts` (L1193, L1461)
- `src/modules/orders/orders.service.ts` — `publishCourierPosition` (L3340)

### 2.5 SSE admin / web

| Route | Source | Intervalle |
|-------|--------|------------|
| `/api/sse/search/reindex` | Job BullMQ search | Event-driven |
| `/api/sse/admin/system-health` | Probes MQTT + Mongo + Redis | Snapshot 120 s, tick 7 s |
| `/api/sse/admin/fleet` | Domain events `agent.*` | Event-driven (si émis) |
| `/api/sse/admin/jobs/:jobId` | AdminJobProgressService | Event-driven |
| `/api/sse/public/checkout/:sessionId` | CheckoutSessionSseService | Event-driven |
| `/api/sse/public/status` | Health probes | Idem system-health |

**Note :** fleet SSE peu alimenté tant que `DeliveryAgentService` n’émet pas `agent.location.updated` / `agent.presence.changed` côté API.

---

## 3. Goulots d’étranglement détaillés

### P0 — Critique (latence / fiabilité)

#### P0-1 — Handlers in-process bloquants

**Où :** `domain-event-publisher.service.ts` L177

```typescript
await this.runInProcessHandler(validated);
// ... puis enqueue MQTT / BullMQ
```

**Problème :** FCM, fulfillment Stripe, audit, refunds s’exécutent **avant** la réponse webhook et **avant** la publication bus.

**Optimisation (sans retirer de feature) :**

- Exécuter handlers via worker BullMQ dédié `domain-events-side-effects`.
- Ou `void this.runInProcessHandler(validated)` + queue avec retry/backoff.
- Webhook répond `{ received: true }` immédiatement ; fulfillment reste idempotent.

**Gain :** p95 webhook −80 %.

---

#### P0-2 — GPS N× populate Mongo

**Où :** `publishCourierPosition` + boucle dans `delivery-agent.service.ts`

**Problème :** Chaque tick GPS relance `findById` + double populate pour **chaque** commande SHIPPED.

**Optimisation :**

1. **Throttle** : max 1 `order.tracking.updated` / 2–5 s / (agent, orderId).
2. **Projection minimale** : `.select('_id status assigned_delivery_user store')` sans populate user complet.
3. **Batch** : une requête `find({ assigned_delivery_user, status: SHIPPED })` puis emit groupé.
4. **Idempotence GPS** : clé `agentId:orderId:roundedLatLng:window` au lieu d’UUID par tick.

**Gain :** −90 % charge Mongo/MQTT sous fleet actif.

---

#### P0-3 — Routage domaine WS incomplet pour commandes client

**Où :** `domain-event-ws-router.service.ts` — `routeOrderUpdate`, `routeOrderTracking`

**Problème :** Seul `order_staff_broadcast` est dispatché. Legacy envoie aussi vers client, vendor, agent.

**Optimisation :**

- Enrichir payload domaine API avec `customerId`, `vendorId`, `deliveryAgentId`.
- Router vers `order_update` + `order_tracking` par party (même logique que `notifyPartiesOrderRealtimeFromDoc`).
- Conserver `order_staff_broadcast` pour admin.

**Gain :** parité fonctionnelle + permet `WS_VIA_BUS=true` en prod.

---

#### P0-4 — Pas de Redis adapter Socket.IO

**Où :** `africa-meals-ws` — aucune référence `@socket.io/redis-adapter`

**Problème :** Rooms Socket.IO locales à l’instance. Multi-réplica Cloud Run → emits perdus.

**Optimisation :**

- Ajouter `@socket.io/redis-adapter` avec connexion Redis existante.
- Documenter min instances + sticky sessions en transition.

**Gain :** scale horizontal WS fiable.

---

### P1 — Haute charge

#### P1-1 — Amplification 7 dispatches WS par statut

**Où :** `notifyPartiesOrderRealtimeFromDoc` (L2492–2514)

Compte par changement statut :

| Destinataire | Dispatches |
|--------------|------------|
| Client | 1–2 (update + tracking) |
| Vendor | 2 |
| Agent | 2 |
| Staff broadcast | 1 |
| **Total** | **jusqu’à 7** |

**Optimisation :**

- Fusionner update + tracking en **un seul message** quand payload identique.
- Payload unifié `order:changed` côté gateway (clients écoutent les deux events aujourd’hui — conserver compat en émettant les deux depuis un seul dispatch interne).

**Gain :** −40 à −50 % messages MQTT/BullMQ.

---

#### P1-2 — Double subscriber MQTT (WS)

**Où :** `chat-mqtt-subscriber.service.ts` + `domain-event-subscriber.service.ts`

**Optimisation :** Un client MQTT, deux handlers de topics (`internal/ws/#` + `domain/#`).

**Gain :** −1 connexion broker / process WS, −RAM.

---

#### P1-3 — Multiples connexions Redis (API)

**Où :** BullMQ (domain-events, ws-notify, search, etc.) + idempotency store ioredis dédié

**Optimisation :** Pool Redis partagé / `connection` BullMQ réutilisée.

**Gain :** −3–6 connexions TCP / process.

---

#### P1-4 — Fulfillment Stripe séquentiel multi-store

**Où :** `stripe-grouped-checkout.service.ts`

**Optimisation :** `Promise.all` sur stores indépendants (idempotence par `storeId + sessionId`).

**Gain :** −60 % latence checkout groupé.

---

#### P1-5 — Doublons ads (legacy + domaine)

**Où :** `AdDomainEventHandler` + legacy MQTT ads

**Optimisation :** Guard `wsViaBus` comme pour order/agent handlers — si bus actif, skip legacy.

**Gain :** −50 % emits ad-manager.

---

#### P1-6 — `readInfraSettings()` répété

**Où :** Chaque dispatch WS et publish domaine (cache 10 s par instance)

**Optimisation :**

- TTL configurable **30–60 s** en prod stable.
- Service `@Injectable()` singleton partagé entre ws-notify et domain publisher.

**Gain :** −Mongo reads sous charge MQTT.

---

### P2 — Efficacité CPU / coût

| # | Problème | Fichier | Optimisation |
|---|----------|---------|--------------|
| P2-1 | Double audit statuts | OrdersService + OrderDomainEventHandler | Un seul chemin |
| P2-2 | Loyalty + archive chat en double à livraison | Idem | Centraliser dans handler OU service |
| P2-3 | Re-fetch order populate après save | `confirmPickup`, handoff | Réutiliser doc en mémoire |
| P2-4 | SSE health `JSON.stringify` pour dedup | `sse-stream-sources.service.ts` | Hash léger (status + checkedAt) |
| P2-5 | Sweep O(n) dedup domaine WS | `domain-event-ws-router.ts` `seen` Map | `setInterval` 30 s |
| P2-6 | `fetchSockets()` à chaque join chat | `chat.gateway.ts` | Compteur join / trust `socket.data` |
| P2-7 | `archive_order_delivery` await dans handler MQTT | `chat-mqtt-subscriber.ts` | Enqueue BullMQ async |

---

### P3 — Mémoire / ops long terme

| # | Problème | Optimisation |
|---|----------|--------------|
| P3-1 | Subjects RxJS SSE sans cleanup | TTL + `complete()` checkout/jobs terminés |
| P3-2 | Limite connexions SSE in-memory / instance | Compteur Redis distribué multi-réplica |
| P3-3 | Fleet SSE non alimenté (pas d’émission `agent.*` API) | Émettre depuis DeliveryAgentService |
| P3-4 | `payment_intent.succeeded` hors branche EDA | Harmoniser avec checkout.completed |

---

## 4. Optimisations par composant

### 4.1 API — Domain events

| Action | Priorité | Effort | Feature impact |
|--------|----------|--------|----------------|
| Handlers async (queue side-effects) | P0 | M | Aucun — même logique, ordre différé |
| Throttle + batch GPS | P0 | M | Aucun — même fréquence perçue client |
| Guard ads `wsViaBus` | P1 | S | Aucun |
| Dédupliquer audit / loyalty / archive | P2 | S | Aucun |
| Client MQTT unique (domain + ws-notify) | P1 | M | Aucun |
| Pool Redis partagé | P1 | M | Aucun |
| Paralléliser fulfillment multi-store | P1 | M | Aucun |
| Émettre `agent.*` depuis DeliveryAgentService | P1 | M | Active SSE-005 + bus fleet |

### 4.2 API — WsNotify

| Action | Priorité | Effort |
|--------|----------|--------|
| Fusionner update + tracking dispatch | P1 | S |
| Passer order doc déjà chargé à notify | P2 | S |
| Env `WS_NOTIFY_LATENCY_SENSITIVE=order/tracking` → MQTT direct | P2 | S |
| Infra cache 30 s singleton | P1 | S |

### 4.3 API — SSE

| Action | Priorité | Effort |
|--------|----------|--------|
| Health checks en `Promise.all` | P2 | S |
| Hash dedup vs JSON.stringify | P2 | S |
| Cleanup Subjects checkout/jobs | P3 | S |
| Limite connexions distribuée Redis | P3 | M |
| Brancher `clearTablesAsync` + panel DB (SSE-006) | P2 | M |

### 4.4 WS — Gateway & dispatch

| Action | Priorité | Effort |
|--------|----------|--------|
| Redis adapter Socket.IO | P0 | M |
| Fusionner 2 subscribers MQTT | P1 | M |
| Compléter DomainEventWsRouter (parties commande) | P0 | M |
| Archive chat → queue async | P2 | S |
| Dedup Redis unifiée legacy + domaine | P2 | M |
| Config explicite : `transports: ['websocket']`, ping 25 s | P2 | S |
| Bypass BullMQ si queue depth < seuil | P2 | S |

### 4.5 MongoDB

| Action | Priorité |
|--------|----------|
| Index `{ assigned_delivery_user, status, shouldShip }` | P0 |
| Documenter pool : API 15–20 + WS 5 × nb instances ≤ limite Atlas | P1 |
| `.lean()` + `.select()` sur handlers / GPS | P1 |

---

## 5. Configuration recommandée

### 5.1 Production performante (post Phase B)

```env
# --- EDA ---
DOMAIN_EVENTS_ENABLED=true
DOMAIN_EVENTS_WS_VIA_BUS=true          # après fix routage WS client (P0-3)
DOMAIN_EVENTS_MQTT_TOPIC_PREFIX=africameals/domain

# --- Infra cache ---
INFRA_RUNTIME_SETTINGS_CACHE_MS=30000

# --- Mongo pool (sommer toutes les instances) ---
MONGOOSE_MAX_POOL=15

# --- BullMQ ---
DOMAIN_EVENTS_QUEUE_CONCURRENCY=20
WS_INTERNAL_DISPATCH_CONCURRENCY=30
WS_NOTIFY_QUEUE_ATTEMPTS=3
WS_NOTIFY_QUEUE_BACKOFF_MS=750

# --- SSE ---
SSE_HEARTBEAT_MS=25000
SSE_MAX_CONNECTIONS_PER_USER=3

# --- MQTT ---
MQTT_QOS=1
# Option tracking-only : MQTT_QOS=0 sur topic tracking (feature flag)
```

### 5.2 Latence minimale (single instance / dev)

```env
DOMAIN_EVENTS_ENABLED=false
# OU redisManagerEnabled=false → MQTT direct sans hop BullMQ
```

### 5.3 Cloud Run

| Paramètre | Valeur |
|-----------|--------|
| Timeout HTTP API | ≥ 60 s (jusqu’à handlers async) |
| Timeout SSE | ≥ 3600 s |
| Min instances WS | ≥ 1 |
| CPU WS | ≥ 1 vCPU si concurrency 40 |
| Sticky sessions | Requis sans Redis adapter |

---

## 6. Plan d’action

### Phase A — Quick wins (1–3 jours)

| # | Tâche | Ticket ref |
|---|-------|------------|
| A1 | Throttle + projection minimale GPS | — |
| A2 | Handlers domaine async (decouple webhook) | EDA-004 |
| A3 | Guard `wsViaBus` ads | EDA-008 |
| A4 | Dédupliquer audit / loyalty / archive | EDA-004 |
| A5 | Infra settings cache 30 s + singleton | — |
| A6 | SSE health : Promise.all + hash dedup | SSE-003 |
| A7 | Archive chat → BullMQ async (WS) | — |

**KPI Phase A :** p95 webhook < 500 ms ; p95 GPS < 100 ms ; −30 % ops Mongo/heure.

### Phase B — Fiabilité & parité (3–7 jours)

| # | Tâche | Ticket ref |
|---|-------|------------|
| B1 | Compléter DomainEventWsRouter (client/vendor/agent) | EDA-003 |
| B2 | Émettre `agent.*` depuis DeliveryAgentService | EDA-007 |
| B3 | Client MQTT unique (API + WS) | — |
| B4 | Pool Redis partagé | — |
| B5 | Fusion update+tracking WS legacy | — |
| B6 | Paralléliser fulfillment multi-store | EDA-006 |
| B7 | Brancher SSE jobs DB maintenance | SSE-006 |
| B8 | Page checkout + meta API | SSE-007 |

**KPI Phase B :** parité mobile/admin legacy vs EDA ; zero timeout webhook.

### Phase C — Scale horizontal (1–2 semaines)

| # | Tâche |
|---|-------|
| C1 | `@socket.io/redis-adapter` |
| C2 | Limite SSE distribuée (Redis) |
| C3 | Cleanup Subjects SSE |
| C4 | Métriques Prometheus (§7) |
| C5 | Load test k6 : 500 WS, 50 GPS/s, 100 cmd/min |

**KPI Phase C :** scale linéaire 2–4 instances WS ; error rate < 0,1 %.

---

## 7. Métriques à instrumenter

| Métrique | Seuil alerte | Composant |
|----------|--------------|-----------|
| `domain_event_publish_duration_ms` | p95 > 100 ms | API publisher |
| `domain_handler_duration_ms{type}` | p95 > 500 ms | Handlers |
| `stripe_webhook_duration_ms` | p95 > 2000 ms | Billing |
| `gps_publish_courier_duration_ms` | p95 > 150 ms | DeliveryAgent |
| `ws_mqtt_message_lag_ms` | p95 > 100 ms | WS subscriber |
| `ws_dispatch_queue_depth` | > 1000 | BullMQ |
| `mongo_pool_wait_ms` | > 50 ms | Mongoose |
| `mqtt_connected` | == 0 | API + WS |
| `sse_active_connections` | > 500 / instance | SSE |
| `domain_ws_duplicate_dropped` | info | Router |

---

## 8. Objectifs latence post-optimisation

| Flux | Aujourd’hui (estimé) | Cible |
|------|----------------------|-------|
| Statut → WS client (legacy) | 50–150 ms | 30–80 ms |
| Statut → WS client (EDA) | incomplet / 100–200 ms | 40–90 ms |
| Webhook Stripe → ack | 2–15 s | < 300 ms |
| Webhook Stripe → commande payée | 2–15 s | 1–5 s (async OK) |
| GPS → WS tracking | 100–500 ms × N | 50–120 ms total |
| SSE health tick | 200 ms–2 s | < 500 ms |
| Chat message → client | 50–200 ms | 30–100 ms |

---

## 9. Risques si non optimisé

| Risque | Probabilité | Conséquence |
|--------|-------------|-------------|
| Timeout webhook Stripe | Moyenne (EDA ON) | Retries Stripe, support |
| Saturation Mongo GPS | Haute (fleet actif) | `WaitQueueTimeout`, lenteur globale |
| Perte events WS multi-réplica | Haute (scale prod) | Commandes « fantômes » mobile |
| Double emits ads | Moyenne (EDA ON) | UI admin instable |
| Fuite mémoire SSE | Basse (long uptime) | OOM instance API |
| Incohérence EDA vs legacy | Haute si `WS_VIA_BUS=true` | Régression mobile |

---

## 10. Suivi des optimisations

| ID | Optimisation | Priorité | Statut |
|----|--------------|----------|--------|
| OPT-001 | Handlers domaine async | P0 | ❌ NOT YET |
| OPT-002 | Throttle + batch GPS | P0 | ❌ NOT YET |
| OPT-003 | Routage WS client domaine | P0 | ❌ NOT YET |
| OPT-004 | Redis adapter Socket.IO | P0 | ❌ NOT YET |
| OPT-005 | Fusion dispatches WS commande | P1 | ❌ NOT YET |
| OPT-006 | Client MQTT unique | P1 | ❌ NOT YET |
| OPT-007 | Pool Redis partagé | P1 | ❌ NOT YET |
| OPT-008 | Fulfillment parallèle multi-store | P1 | ❌ NOT YET |
| OPT-009 | Guard ads wsViaBus | P1 | ❌ NOT YET |
| OPT-010 | Émission agent.* API | P1 | ❌ NOT YET |
| OPT-011 | Dedup audit/loyalty/archive | P2 | ❌ NOT YET |
| OPT-012 | SSE health Promise.all + hash | P2 | ❌ NOT YET |
| OPT-013 | Archive chat async WS | P2 | ❌ NOT YET |
| OPT-014 | Cleanup Subjects SSE | P3 | ❌ NOT YET |
| OPT-015 | Limite SSE distribuée | P3 | ❌ NOT YET |

### Légende statut

| Statut | Signification |
|--------|---------------|
| **✅ DONE** | Optimisation déployée et validée |
| **⚠️ IN PROGRESS** | PR ou branche en cours |
| **❌ NOT YET** | Non traité |

---

## 11. Conclusion

Le stack API/WS Wise Eat est **fonctionnellement riche** mais en **transition architecturale** (legacy MQTT ↔ bus domaine ↔ SSE). Les gains les plus importants viennent de :

1. **Désynchroniser** les handlers lourds du chemin HTTP/webhook.
2. **Réduire l’amplification** (7 dispatches, N populate GPS, doubles connexions).
3. **Compléter le routage domaine WS** avant d’activer `DOMAIN_EVENTS_WS_VIA_BUS=true` en production.
4. **Préparer le scale horizontal** WS via Redis adapter.

Aucune fonctionnalité ne doit être supprimée : il s’agit de **réorganiser le travail** pour un système rapide, fiable et efficient.

---

*Document généré par analyse statique du code. Validation recommandée : profiling (Clinic.js, MongoDB profiler, Stripe dashboard webhook latency) avant/après Phase A.*
