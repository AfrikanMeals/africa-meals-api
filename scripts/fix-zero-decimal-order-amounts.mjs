#!/usr/bin/env node
/**
 * Correction MongoDB directe (mongosh / node) — commandes zero-decimal mal divisées par 100.
 *
 * Prérequis : variable MONGODB_URI ou connexion mongosh active.
 *
 * Dry-run (affiche les updates sans écrire) :
 *   node scripts/fix-zero-decimal-order-amounts.mjs
 *
 * Application :
 *   node scripts/fix-zero-decimal-order-amounts.mjs --apply
 *
 * Filtres :
 *   node scripts/fix-zero-decimal-order-amounts.mjs --currency=XAF --since=2025-01-01
 *   node scripts/fix-zero-decimal-order-amounts.mjs --order-id=507f1f77bcf86cd799439011 --apply
 *
 * Via mongosh :
 *   mongosh "$MONGODB_URI" --file scripts/fix-zero-decimal-order-amounts.mjs
 */
import { MongoClient, ObjectId } from 'mongodb';

const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

const PAID_STATUSES = ['paied', 'approved', 'shipped', 'completed'];

function parseArgs(argv) {
  let apply = false;
  let since = null;
  let currency = null;
  let orderId = null;
  let limit = null;

  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg.startsWith('--since=')) {
      const d = new Date(arg.slice(8).trim());
      if (!Number.isNaN(d.getTime())) since = d;
    } else if (arg.startsWith('--currency=')) {
      currency = arg.slice(11).trim().toUpperCase() || null;
    } else if (arg.startsWith('--order-id=')) {
      orderId = arg.slice(11).trim() || null;
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice(8));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }

  return { apply, since, currency, orderId, limit };
}

function factor(currency) {
  const c = String(currency ?? '').trim().toUpperCase();
  return ZERO_DECIMAL.has(c) ? 1 : 100;
}

function roundMoney(n) {
  return Math.round(n * 100 + Number.EPSILON) / 100;
}

function computeCorrect(row) {
  const currency = String(row.currency ?? '').trim().toUpperCase();
  if (!currency || !ZERO_DECIMAL.has(currency)) return null;

  const gC = Math.max(0, Math.round(Number(row.stripe_charged_goods_cents) || 0));
  const sC = Math.max(
    0,
    Math.round(Number(row.stripe_charged_ship_cents) || 0),
  );
  if (gC <= 0 && sC <= 0) return null;

  const f = factor(currency);
  const taxTotal = Math.max(0, Number(row.tax_total) || 0);
  const taxPart = Math.round(taxTotal * f + Number.EPSILON);
  const totalMinor = Math.round(gC + sC + taxPart + Number.EPSILON);
  const correctTotal = totalMinor / f;
  const correctShipping = sC / f;

  const storedTotal = Math.max(0, Number(row.total_price) || 0);
  const storedShipping = Math.max(0, Number(row.shipping_price) || 0);

  const legacyWrongTotal =
    Math.round(gC + sC + Math.round(taxTotal * 100 + Number.EPSILON)) / 100;
  const legacyWrongShipping = sC / 100;

  const totalMismatch = Math.abs(storedTotal - correctTotal) > 0.009;
  const looksLegacy =
    f === 1 &&
    (Math.abs(storedTotal - legacyWrongTotal) < 0.02 ||
      Math.abs(storedShipping - legacyWrongShipping) < 0.02);

  if (!totalMismatch && !looksLegacy) return null;

  return {
    _id: row._id,
    currency,
    before: {
      total_price: roundMoney(storedTotal),
      shipping_price: roundMoney(storedShipping),
    },
    after: {
      total_price: roundMoney(correctTotal),
      shipping_price: roundMoney(correctShipping),
    },
    stripe: { gC, sC, taxTotal },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URL ||
    'mongodb://127.0.0.1:27017/africa-meals';

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const col = db.collection('orders');

  const match = {
    status: { $in: PAID_STATUSES },
    currency: opts.currency
      ? opts.currency
      : { $in: Array.from(ZERO_DECIMAL) },
    stripe_charged_goods_cents: { $exists: true, $gt: 0 },
  };

  if (opts.since) match.createdAt = { $gte: opts.since };
  if (opts.orderId) {
    if (!ObjectId.isValid(opts.orderId)) {
      throw new Error(`order-id invalide : ${opts.orderId}`);
    }
    match._id = new ObjectId(opts.orderId);
  }

  let cursor = col.find(match).sort({ createdAt: 1 });
  if (opts.limit) cursor = cursor.limit(opts.limit);

  const rows = await cursor.toArray();
  const plans = rows.map(computeCorrect).filter(Boolean);

  console.log('');
  console.log('=== fix-zero-decimal-order-amounts (MongoDB direct) ===');
  console.log(`URI         : ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
  console.log(`Mode        : ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Scannées    : ${rows.length}`);
  console.log(`À corriger  : ${plans.length}`);
  console.log('');

  if (!plans.length) {
    console.log('Aucune commande à corriger.');
    await client.close();
    return;
  }

  for (let i = 0; i < plans.length; i++) {
    const p = plans[i];
    console.log(
      [
        `[${i + 1}/${plans.length}]`,
        String(p._id),
        p.currency,
        `total ${p.before.total_price} → ${p.after.total_price}`,
        `ship ${p.before.shipping_price} → ${p.after.shipping_price}`,
        `(gC=${p.stripe.gC} sC=${p.stripe.sC} tax=${p.stripe.taxTotal})`,
      ].join(' · '),
    );

    if (opts.apply) {
      await col.updateOne(
        { _id: p._id },
        {
          $set: {
            total_price: p.after.total_price,
            shipping_price: p.after.shipping_price,
          },
        },
      );
    }
  }

  console.log('');
  console.log(
    opts.apply
      ? `✓ ${plans.length} commande(s) mises à jour.`
      : 'Dry-run — relancez avec --apply pour écrire.',
  );

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
