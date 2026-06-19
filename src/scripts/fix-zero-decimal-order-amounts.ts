/**
 * Corrige total_price / shipping_price des commandes payées en devise Stripe
 * « zero-decimal » (XAF, XOF, JPY…) où l’API divisait encore par 100.
 *
 * Usage (depuis africa-meals-api) :
 *   npm run orders:fix-zero-decimal              # dry-run (défaut)
 *   npm run orders:fix-zero-decimal -- --apply     # écrit en base
 *   npm run orders:fix-zero-decimal -- --currency=XAF --since=2025-01-01
 *   npm run orders:fix-zero-decimal -- --order-id=507f1f77bcf86cd799439011 --apply
 *
 * MongoDB brut (mongosh) : voir scripts/fix-zero-decimal-order-amounts.mjs
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import {
  fromStripeMinorUnits,
  isStripeZeroDecimalCurrency,
  stripeAmountFactor,
  toStripeMinorUnits,
} from '@utils/stripe-currency-amount.util';

type CliOptions = {
  apply: boolean;
  limit: number | null;
  since: Date | null;
  currency: string | null;
  orderId: string | null;
  logEvery: number;
};

type OrderRow = {
  _id: Types.ObjectId;
  currency?: string;
  status?: string;
  totalPrice?: number;
  shippingPrice?: number;
  taxTotal?: number;
  subtotalBeforeTax?: number;
  stripeChargedGoodsCents?: number;
  stripeChargedShipCents?: number;
  deliveryTipCents?: number;
  createdAt?: Date;
};

type FixPlan = {
  orderId: string;
  currency: string;
  status: string;
  createdAt?: string;
  before: {
    totalPrice: number;
    shippingPrice: number;
  };
  after: {
    totalPrice: number;
    shippingPrice: number;
  };
  stripe: {
    goodsCents: number;
    shipCents: number;
    taxTotalMajor: number;
  };
};

function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let limit: number | null = null;
  let since: Date | null = null;
  let currency: string | null = null;
  let orderId: string | null = null;
  let logEvery = 50;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
      continue;
    }
    if (arg.startsWith('--since=')) {
      const d = new Date(arg.slice('--since='.length).trim());
      if (!Number.isNaN(d.getTime())) since = d;
      continue;
    }
    if (arg.startsWith('--currency=')) {
      const c = arg.slice('--currency='.length).trim().toUpperCase();
      if (c) currency = c;
      continue;
    }
    if (arg.startsWith('--order-id=')) {
      const id = arg.slice('--order-id='.length).trim();
      if (id) orderId = id;
      continue;
    }
    if (arg.startsWith('--log-every=')) {
      const n = Number(arg.slice('--log-every='.length));
      if (Number.isFinite(n) && n >= 1) logEvery = Math.floor(n);
    }
  }

  return { apply, limit, since, currency, orderId, logEvery };
}

function roundMoney(n: number): number {
  return Math.round(n * 100 + Number.EPSILON) / 100;
}

function computeCorrectAmounts(row: OrderRow): FixPlan | null {
  const currency = String(row.currency ?? '').trim().toUpperCase();
  if (!currency || !isStripeZeroDecimalCurrency(currency)) {
    return null;
  }

  const gC = Math.max(0, Math.round(Number(row.stripeChargedGoodsCents) || 0));
  const sC = Math.max(0, Math.round(Number(row.stripeChargedShipCents) || 0));
  if (gC <= 0 && sC <= 0) {
    return null;
  }

  const taxTotal = Math.max(0, Number(row.taxTotal) || 0);
  const taxPart = toStripeMinorUnits(taxTotal, currency);
  const totalMinor = Math.round(gC + sC + taxPart + Number.EPSILON);
  const correctTotal = fromStripeMinorUnits(totalMinor, currency);
  const correctShipping = fromStripeMinorUnits(sC, currency);

  const storedTotal = Math.max(0, Number(row.totalPrice) || 0);
  const storedShipping = Math.max(0, Number(row.shippingPrice) || 0);

  // Détecte l’ancien bug : division par 100 au lieu du facteur devise.
  const factor = stripeAmountFactor(currency);
  const legacyWrongTotal =
    Math.round(gC + sC + Math.round(taxTotal * 100 + Number.EPSILON)) / 100;
  const legacyWrongShipping = sC / 100;

  const totalMismatch = Math.abs(storedTotal - correctTotal) > 0.009;
  const looksLegacy =
    factor === 1 &&
    (Math.abs(storedTotal - legacyWrongTotal) < 0.02 ||
      Math.abs(storedShipping - legacyWrongShipping) < 0.02);

  if (!totalMismatch && !looksLegacy) {
    return null;
  }

  return {
    orderId: String(row._id),
    currency,
    status: String(row.status ?? ''),
    createdAt: row.createdAt?.toISOString?.(),
    before: {
      totalPrice: roundMoney(storedTotal),
      shippingPrice: roundMoney(storedShipping),
    },
    after: {
      totalPrice: roundMoney(correctTotal),
      shippingPrice: roundMoney(correctShipping),
    },
    stripe: {
      goodsCents: gC,
      shipCents: sC,
      taxTotalMajor: taxTotal,
    },
  };
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const paidStatuses = [
    OrderStatusEnum.PAIED,
    OrderStatusEnum.APPROVED,
    OrderStatusEnum.SHIPPED,
    OrderStatusEnum.COMPLETED,
  ];

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const orderModel = app.get<Model<OrderModel>>(
      getModelToken(OrderModel.name),
    );

    const match: Record<string, unknown> = {
      status: { $in: paidStatuses },
      currency: opts.currency
        ? opts.currency
        : {
            $in: [
              'XAF',
              'XOF',
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
              'XPF',
            ],
          },
      stripeChargedGoodsCents: { $exists: true, $gt: 0 },
    };

    if (opts.since) {
      match.createdAt = { $gte: opts.since };
    }
    if (opts.orderId) {
      if (!Types.ObjectId.isValid(opts.orderId)) {
        throw new Error(`order-id invalide : ${opts.orderId}`);
      }
      match._id = new Types.ObjectId(opts.orderId);
    }

    const query = orderModel
      .find(match)
      .select([
        '_id',
        'currency',
        'status',
        'totalPrice',
        'shippingPrice',
        'taxTotal',
        'subtotalBeforeTax',
        'stripeChargedGoodsCents',
        'stripeChargedShipCents',
        'deliveryTipCents',
        'createdAt',
      ])
      .sort({ createdAt: 1 })
      .lean();

    if (opts.limit != null) {
      query.limit(opts.limit);
    }

    const rows = (await query.exec()) as OrderRow[];
    const plans: FixPlan[] = [];

    for (const row of rows) {
      const plan = computeCorrectAmounts(row);
      if (plan) plans.push(plan);
    }

    console.log('');
    console.log('=== Correction montants zero-decimal (orders) ===');
    console.log(`Mode        : ${opts.apply ? 'APPLY (écriture)' : 'DRY-RUN'}`);
    console.log(`Candidates  : ${rows.length} commande(s) scannée(s)`);
    console.log(`À corriger  : ${plans.length} commande(s)`);
    if (opts.since) console.log(`Since       : ${opts.since.toISOString()}`);
    if (opts.currency) console.log(`Currency    : ${opts.currency}`);
    if (opts.orderId) console.log(`Order id    : ${opts.orderId}`);
    console.log('');

    if (!plans.length) {
      console.log('Aucune commande à corriger.');
      return;
    }

    let applied = 0;
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      console.log(
        [
          `[${i + 1}/${plans.length}]`,
          plan.orderId,
          plan.currency,
          plan.status,
          plan.createdAt?.slice(0, 10) ?? '—',
          `total ${plan.before.totalPrice} → ${plan.after.totalPrice}`,
          `ship ${plan.before.shippingPrice} → ${plan.after.shippingPrice}`,
          `(gC=${plan.stripe.goodsCents} sC=${plan.stripe.shipCents} tax=${plan.stripe.taxTotalMajor})`,
        ].join(' · '),
      );

      if (opts.apply) {
        await orderModel
          .updateOne(
            { _id: new Types.ObjectId(plan.orderId) },
            {
              $set: {
                totalPrice: plan.after.totalPrice,
                shippingPrice: plan.after.shippingPrice,
              },
            },
          )
          .exec();
        applied++;
      }

      if ((i + 1) % opts.logEvery === 0) {
        console.log(`… ${i + 1} / ${plans.length} traitées`);
      }
    }

    console.log('');
    if (opts.apply) {
      console.log(`✓ ${applied} commande(s) mises à jour.`);
    } else {
      console.log('Dry-run terminé. Relancez avec --apply pour écrire en base.');
    }
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
