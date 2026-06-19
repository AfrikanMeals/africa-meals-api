# Pourboire livreur — rapport d’implémentation

Date : 2026-06-18  
Périmètre : API Nest, checkout Stripe groupé, versement livreur, remboursement, app mobile (checkout).

---

## 1. Objectif

Permettre au client de laisser un **pourboire livreur** lors d’un checkout groupé (plusieurs boutiques), avec :

- configuration admin (activé/désactivé, **plusieurs options** montant fixe ou % commande, plus montant personnalisé côté app) ;
- **un seul montant** saisi par le client ;
- **répartition automatique** par commande livraison (`by_shipping_fee`) ;
- **versement au livreur assigné** à la livraison terminée (`completed`) ;
- **remboursement de la part tip** si la commande est annulée avant versement.

---

## 2. Modèle de données

### `platform_shipping_settings` (existant, admin)

| Champ | Rôle |
|-------|------|
| `deliveryTipEnabled` | Active le bloc pourboire |
| `deliveryTipMode` | `fixed` \| `percent` |
| `deliveryTipFixed` | 1ᵉʳ preset en mode `fixed` (rétrocompat.) |
| `deliveryTipPercent` | 1ᵉʳ preset en mode `percent` (rétrocompat.) |
| `deliveryTipPresets` | Liste legacy (1 seul mode) |
| `deliveryTipFixedPresets` | Options montant fixe ($) |
| `deliveryTipPercentPresets` | Options pourcentage (% sous-total livraison) |

Les montants fixes admin sont libellés dans `platform_shipping_settings.currency` (base **CAD**). L’app mobile convertit ces montants vers la devise checkout (ex. XAF) via les taux journaliers CAD (`ExchangeRatesService` / API Fawaz Ahmed). Les pourcentages s’appliquent au sous-total livraison dans la devise checkout (sans conversion).

### `orders` (nouveau)

| Champ | Rôle |
|-------|------|
| `deliveryTipCents` | Part allouée à cette commande |
| `deliveryTipStatus` | `none` \| `pending` \| `transferred` \| `refunded` |
| `deliveryTipAllocationMethod` | ex. `by_shipping_fee` |
| `stripeDeliveryTipTransferId` | Transfer Connect tip |
| `stripeDeliveryTipTransferAmountCents` | Net versé livreur |
| `stripeDeliveryTipProcessingFeeCents` | Part frais Stripe imputée au tip |

Le tip **n’est pas** inclus dans `totalPrice` vendeur (goods + ship + taxes) ; il est facturé via une ligne Stripe plateforme séparée.

---

## 3. Algorithme de répartition

Fichier : `src/modules/billing/delivery-tip-allocation.util.ts`

```
tipOrder[i] = floor(tipTotal × shipCents[i] / Σ shipCents)
remainder → dernière boutique (tri storeId asc)
```

Fallback **parts égales** si toutes les `shipCents` sont 0.

Plafond tip checkout : **50 %** du sous-total articles des boutiques en livraison.

Tests unitaires : `delivery-tip-allocation.util.spec.ts` (Jest).

---

## 4. API

### Preview (JWT client)

`POST /billing/checkout/delivery-tip-preview`

```json
{
  "addressId": "…",
  "fulfillmentByStoreId": { "storeId": "delivery" },
  "deliveryTipTotalCents": 1200
}
```

Réponse : `allocationPreview[]`, `suggestedTipCents`, `deliveryLegCount`, etc.

Service : `DeliveryTipService` (`src/modules/billing/delivery-tip.service.ts`).

### Checkout groupé (extension)

`POST /billing/stripe/grouped-checkout-session`  
`POST /billing/stripe/grouped-payment-intent`

Body additionnel :

```json
{ "deliveryTipTotalCents": 1200 }
```

Comportement :

1. Recalcul serveur de la répartition (le client ne fournit pas le split).
2. Ligne Stripe « Pourboire livreur ».
3. Metadata session : `tipTotalCents`, `tipB64` (map storeId → cents), `tipAllocMethod`.

Webhook / sync : à la création de chaque commande livraison, persistance via `markOrderPaidWithShipping({ deliveryTipCents, … })`.

---

## 5. Versement livreur

`StripeConnectTransferService.transferDeliveryTipForCompletedOrder`

- Déclenché au `completed` (même flux que la part livraison).
- 100 % du tip alloué − part frais Stripe processing.
- Transfer Connect `transferKind: delivery_tip`.
- `deliveryTipStatus` → `transferred`.

Helper : `OrdersService.scheduleDeliveryAgentPayouts(orderId)` (shipping + tip).

### Gains livreur (dashboard API)

`GET /delivery-agent/payments/shipping-earnings` (JWT livreur) :

- Filtre : commandes assignées au livreur (`assignedDeliveryUser`).
- Par ligne : `driverEarningCad`, `deliveryTipCents`, `deliveryTipStatus`, `driverTipEarningCad`, `driverTotalEarningCad`, `currency`.
- Agrégat : `totals.driverEarningCad`, `totals.driverTipEarningCad`, `totals.driverTotalEarningCad`.

---

## 6. Remboursement

`RefundProcessingService.refundAmountCents` inclut `deliveryTipCents` si `deliveryTipStatus === pending` **ou `transferred`**.

À la clôture du remboursement : `deliveryTipStatus` → `refunded`.

Si le tip était déjà `transferred`, `StripeConnectTransferService.reverseTransferForRefund` effectue un **clawback intégral** du virement tip (`forceFullReversal`) avant le remboursement Stripe client.

Champs order : `stripeDeliveryTipTransferReversalId`, `stripeDeliveryTipTransferReversalAmountCents`.

---

## 7. Mobile (Flutter)

| Fichier | Changement |
|---------|------------|
| `lib/domaine/entities/delivery_tip_preview.dart` | Modèles preview |
| `lib/commons/endpoints.dart` | `billingDeliveryTipPreview` |
| `lib/data/repositories/store_repository.dart` | `fetchDeliveryTipPreview` |
| `lib/utils/stripe_grouped_checkout_payload.dart` | `deliveryTipTotalCents` |
| `lib/pages/shop/grouped_checkout_delivery_page.dart` | UI chips Aucun / Suggéré / Autre + preview split + total |

---

## 8. Admin

Déjà en place : `/livraisons/shipping-settings` (section « Pourboire livreur »).

---

## 9. Déploiement / tests manuels

1. Admin : activer tip, fixe 3 $ ou 10 %.
2. Panier 2 boutiques livraison, adresse valide → preview affiche 2 lignes.
3. Payer → vérifier metadata Stripe `tipB64`.
4. Commandes : `deliveryTipCents` + `pending`.
5. Livrer (`completed`) + livreur Connect → transfer tip.
6. Annuler une commande avant livraison → remboursement inclut la part tip.

Redémarrer `we-api-dev` après pull.

---

## 10. Évolutions réalisées (2026-06-19)

- Remboursement tip après `transferred` (clawback admin via reversal Connect + remboursement client).
- Exposition tip dans gains livreur (`GET /delivery-agent/payments/shipping-earnings` : `deliveryTipCents`, `driverTipEarningCad`, `driverTotalEarningCad`, `totals`).
- Page statut / reçu client mobile avec ligne pourboire + total payé (`client_order_detail_page`, `my_orders_page`).
- Reçu e-mail : ligne « Pourboire livreur » dans `order-receipt-email-html.util.ts`.

## 11. Évolutions possibles (hors scope)

- Tip par boutique dans l’UI (au lieu d’un montant global).

---

## 12. Fichiers principaux modifiés

**API**

- `src/modules/billing/delivery-tip-allocation.util.ts`
- `src/modules/billing/delivery-tip.service.ts`
- `src/modules/billing/dto/delivery-tip-preview.dto.ts`
- `src/modules/billing/billing.controller.ts`
- `src/modules/billing/stripe/stripe-grouped-checkout.service.ts`
- `src/modules/billing/stripe/stripe-connect-transfer.service.ts`
- `src/modules/billing/stripe/dto/grouped-stripe-checkout.dto.ts`
- `src/schemas/order.schema.ts`
- `src/modules/orders/orders.service.ts`
- `src/modules/refunds/refund-processing.service.ts`

**Mobile**

- `lib/domaine/entities/delivery_tip_preview.dart`
- `lib/pages/shop/grouped_checkout_delivery_page.dart`
- (+ endpoints, repository, payload)
