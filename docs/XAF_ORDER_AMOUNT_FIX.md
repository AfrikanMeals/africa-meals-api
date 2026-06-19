# Correction MongoDB — montants commandes XAF / zero-decimal

## Contexte

Les commandes payées en **XAF** (et autres devises Stripe sans décimales) pouvaient enregistrer :

- `total_price` et `shipping_price` **÷ 100** au lieu du facteur devise (×1 pour XAF)
- L’app mobile affichait le pourboire **÷ 100** (`500 FCFA` → `5,00 FCFA`)

Corrections code (API + mobile) : voir commits associés.  
Ce document décrit la **rétro-correction** des commandes déjà en base.

## Champs concernés

| MongoDB (snake_case) | Mongoose | Recalcul |
|----------------------|----------|----------|
| `total_price` | `totalPrice` | `(goodsCents + shipCents + taxMinor) / factor` |
| `shipping_price` | `shippingPrice` | `shipCents / factor` |

**Non modifiés** (déjà corrects en unités Stripe) :

- `stripe_charged_goods_cents`, `stripe_charged_ship_cents`
- `delivery_tip_cents` (ex. `500` = 500 FCFA)
- `tax_total` (montant affiché / taxes régionales)

`factor = 1` pour XAF, XOF, JPY, etc. (`stripe-currency-amount.util.ts`).

## Script Nest (recommandé)

Depuis `africa-meals-api` :

```bash
# Aperçu sans écriture
npm run orders:fix-zero-decimal

# Une devise / période
npm run orders:fix-zero-decimal -- --currency=XAF --since=2025-01-01

# Une commande précise
npm run orders:fix-zero-decimal -- --order-id=6a1ac069f79292022ab2a4f4 --apply

# Appliquer toutes les corrections détectées
npm run orders:fix-zero-decimal -- --apply
```

Options :

| Option | Description |
|--------|-------------|
| `--apply` | Écrit en base (sinon dry-run) |
| `--currency=XAF` | Limite à une devise |
| `--since=2025-06-01` | `createdAt >= date` |
| `--order-id=…` | Une seule commande |
| `--limit=100` | Max N documents scannés |
| `--log-every=50` | Fréquence logs |

## Script MongoDB direct

Sans Nest, avec `mongodb` driver (URI dans `.env`) :

```bash
cd africa-meals-api
node scripts/fix-zero-decimal-order-amounts.mjs
node scripts/fix-zero-decimal-order-amounts.mjs --currency=XAF --apply
```

## Vérification manuelle (mongosh)

```javascript
db.orders.findOne(
  { _id: ObjectId('…') },
  {
    currency: 1,
    total_price: 1,
    shipping_price: 1,
    tax_total: 1,
    stripe_charged_goods_cents: 1,
    stripe_charged_ship_cents: 1,
    delivery_tip_cents: 1,
  },
);
```

Recalcul attendu (XAF) :

```javascript
const gC = doc.stripe_charged_goods_cents;
const sC = doc.stripe_charged_ship_cents;
const tax = doc.tax_total || 0;
const correctTotal = gC + sC + tax; // factor 1
const correctShip = sC;
```

Exemple bug : `total_price: 101.11` avec `gC=9611`, `sC=500`, `tax=0` → corrigé **`10111` FCFA**.

## Après correction

1. Redémarrer l’API (correctif `markOrderPaidWithShipping` déjà déployé).
2. Hot reload / rebuild app mobile (affichage pourboire + `formatMoneyWithCurrency` XAF).
3. Vérifier la fiche commande client : total ≈ sous-total + livraison + taxes ; pourboire en entiers FCFA.

## Rollback

Conserver la sortie dry-run avant `--apply`. Pour annuler une commande :

```javascript
db.orders.updateOne(
  { _id: ObjectId('…') },
  {
    $set: {
      total_price: 101.11,
      shipping_price: 5.0,
    },
  },
);
```

(Adaptez aux valeurs `before` loguées par le script.)
