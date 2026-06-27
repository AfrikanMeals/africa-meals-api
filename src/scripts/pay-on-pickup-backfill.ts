import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';

type CliOptions = {
  apply: boolean;
  limit: number | null;
  since: Date | null;
  batchLogEvery: number;
};

function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let limit: number | null = null;
  let since: Date | null = null;
  let batchLogEvery = 100;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) {
        limit = Math.floor(n);
      }
      continue;
    }
    if (arg.startsWith('--since=')) {
      const raw = arg.slice('--since='.length).trim();
      if (raw.length > 0) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
          since = d;
        }
      }
      continue;
    }
    if (arg.startsWith('--log-every=')) {
      const n = Number(arg.slice('--log-every='.length));
      if (Number.isFinite(n) && n >= 1) {
        batchLogEvery = Math.floor(n);
      }
    }
  }

  return { apply, limit, since, batchLogEvery };
}

/** Ancienne heuristique : payée sans Stripe parent, statut workflow actif. */
function buildLegacyHeuristicMatch(): Record<string, unknown> {
  const activeStatuses = [
    OrderStatusEnum.PAIED,
    OrderStatusEnum.APPROVED,
    OrderStatusEnum.SHIPPED,
    OrderStatusEnum.COMPLETED,
  ];
  return {
    status: { $in: activeStatuses },
    $and: [
      {
        $or: [
          { payOnPickup: { $exists: false } },
          { payOnPickup: false },
          { pay_on_pickup: { $exists: false } },
          { pay_on_pickup: false },
        ],
      },
      {
        $or: [
          { stripeParentPaymentId: { $exists: false } },
          { stripeParentPaymentId: null },
          { stripeParentPaymentId: '' },
          { stripe_parent_payment_id: { $exists: false } },
          { stripe_parent_payment_id: null },
          { stripe_parent_payment_id: '' },
        ],
      },
    ],
  };
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const orderModel = app.get<Model<OrderModel>>(
      getModelToken(OrderModel.name),
    );

    const match: Record<string, unknown> = {
      ...buildLegacyHeuristicMatch(),
    };
    if (opts.since) {
      match.updatedAt = { $gte: opts.since };
    }

    const conflictMatch = {
      payOnPickup: true,
      stripeParentPaymentId: {
        $exists: true,
        $nin: [null, ''],
      },
    };
    const conflictCount = await orderModel.countDocuments(conflictMatch).exec();

    const totalCandidates = await orderModel.countDocuments(match).exec();
    console.log(
      `[pay-on-pickup-backfill] candidates=${totalCandidates} stripeConflicts=${conflictCount} apply=${
        opts.apply
      } limit=${opts.limit ?? 'none'} since=${
        opts.since ? opts.since.toISOString() : 'none'
      }`,
    );

    if (conflictCount > 0) {
      console.warn(
        `[pay-on-pickup-backfill] ${conflictCount} commande(s) ont payOnPickup=true ET stripeParentPaymentId — vérifier manuellement.`,
      );
    }

    if (!opts.apply) {
      console.log(
        '[pay-on-pickup-backfill] dry-run only. Re-run with --apply to set payOnPickup=true.',
      );
      return;
    }

    let processed = 0;
    let updated = 0;

    const cursor = orderModel
      .find(match)
      .select('_id')
      .sort({ _id: 1 })
      .lean()
      .cursor();

    for await (const row of cursor) {
      if (opts.limit != null && processed >= opts.limit) break;

      const oid = (() => {
        const raw = (row as { _id?: unknown })._id;
        if (raw instanceof Types.ObjectId) return raw.toHexString();
        return String(raw ?? '').trim();
      })();
      if (!oid || !Types.ObjectId.isValid(oid)) continue;

      processed += 1;
      const res = await orderModel
        .updateOne(
          { _id: new Types.ObjectId(oid) },
          { $set: { payOnPickup: true } },
        )
        .exec();
      if (res.modifiedCount > 0) updated += 1;

      if (processed % opts.batchLogEvery === 0) {
        console.log(
          `[pay-on-pickup-backfill] progress processed=${processed} updated=${updated}`,
        );
      }
    }

    console.log(
      `[pay-on-pickup-backfill] done processed=${processed} updated=${updated}`,
    );
  } finally {
    await app.close();
  }
}

void run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[pay-on-pickup-backfill] fatal: ${msg}`);
    process.exit(1);
  });
