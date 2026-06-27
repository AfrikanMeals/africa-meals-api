# Inventaire routes internes API ↔ WS (GRPC-004)

**Date :** 24 juin 2026

## API → WS (`WsNotifyDispatchQueueService`)

| Suffixe HTTP | gRPC | Payload clés | Socket.IO |
|--------------|------|--------------|-----------|
| `inbox/refresh` | `InboxRefresh` | `userId` | `inbox:feed:refresh` → `user:{id}` |
| `order/update` | `OrderDispatch` | `userId`, tracking | `order:update` |
| `order/tracking` | `OrderDispatch` | `userId`, tracking | `order:tracking` |
| `order/changed` | `OrderDispatch` | `userId`, tracking | update + tracking |
| `order/staff-broadcast` | `OrderDispatch` / batch | tracking | `orders:admin` |
| `stripe/connect-status` | `GenericDispatch` | `userId`, `status` | connect status |
| `ads-targeting/event` | `GenericDispatch` | event body | ads stream |
| `ad-manager/event` | `GenericDispatch` | event body | ad manager stream |
| `chat/archive-order-delivery` | `GenericDispatch` | `orderId`, `reason` | archive chats |
| `delivery-agent/presence` | `GenericDispatch` | `userId` / `agentUserId` | presence |
| `platform/maintenance` | `GenericDispatch` | maintenance body | platform event |

**Canal legacy :** MQTT `africameals/internal/ws/{suffix}` → BullMQ `ws-notify` → HTTP POST.

**Canal gRPC (flag) :** `NotifyService` sur WS `:50051` — fallback HTTP si `GRPC_HTTP_FALLBACK_ENABLED=true`.

## WS → API

| Route HTTP | gRPC | Service |
|------------|------|---------|
| `GET /internal/inbox/vendor-feed` | `InboxFeedService.GetVendorFeed` | Fil notifications vendeur |
| `POST /internal/notifications/chat-message` | `ChatPushService.NotifyChatMessage` | Push FCM chat |
| `GET /internal/mqtt/status` | — | Statut MQTT (HTTP only) |
| `POST /internal/secret-manager/env-preview` | — | Aperçu secrets (HTTP only) |

**Serveur gRPC API :** port `50052` (flag `GRPC_WS_TO_API_ENABLED` côté WS).

## Domain events (bus MQTT)

Topic : `africameals/domain/order.*` → `DomainEventWsRouterService` (WS) — pas de gRPC direct ; évite double dispatch API quand `DOMAIN_EVENTS_WS_VIA_BUS=true`.

## STOMP (clients admin / mobile — dual-stack)

Le pipeline API → WS (HTTP / gRPC / MQTT / BullMQ) est **inchangé**. `RealtimeDispatcherService` émet en parallèle Socket.IO et STOMP.

Référence protocole : `africa-meals-ws/docs/STOMP_PROTOCOL.md`.

| Socket.IO (legacy) | STOMP subscribe | STOMP SEND |
|--------------------|-----------------|------------|
| `inbox:feed:refresh` | `/user/queue/inbox-feed` | — |
| `order:update` | `/user/queue/order-update` | — |
| `order:tracking` | `/user/queue/order-tracking` | — |
| `order:list:changed` | `/user/queue/order-list-changed` | — |
| `message:new` | `/topic/conv/{id}/message` | `/app/chat/message/send` |
| `join` / `leave` | ACK `/user/queue/ack` | `/app/chat/join`, `/app/chat/leave` |
| `platform:maintenance` | `/topic/platform/maintenance` | — |

**Flags clients :** admin `NEXT_PUBLIC_REALTIME_PROTOCOL` · mobile Remote Config `realtime_protocol`.
