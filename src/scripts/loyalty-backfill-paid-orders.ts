import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
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

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const statuses = [
    OrderStatusEnum.PAIED,
    OrderStatusEnum.APPROVED,
    OrderStatusEnum.SHIPPED,
    OrderStatusEnum.COMPLETED,
  ];

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const loyalty = app.get(LoyaltyService);
    const orderModel = app.get<Model<OrderModel>>(getModelToken(OrderModel.name));

    const match: Record<string, unknown> = {
      status: { $in: statuses },
      $or: [
        { loyaltyPointsCredited: { $exists: false } },
        { loyaltyPointsCredited: false },
      ],
    };

    if (opts.since) {
      match.updatedAt = { $gte: opts.since };
    }

    const totalCandidates = await orderModel.countDocuments(match).exec();
    console.log(
      `[loyalty-backfill] candidates=${totalCandidates} apply=${opts.apply} limit=${
        opts.limit ?? 'none'
      } since=${opts.since ? opts.since.toISOString() : 'none'}`,
    );

    if (!opts.apply) {
      console.log(
        '[loyalty-backfill] dry-run only. Re-run with --apply to credit points.',
      );
      return;
    }

    let processed = 0;
    let success = 0;
    let failed = 0;

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
      try {
        await loyalty.creditOrderCompletion(oid);
        success += 1;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[loyalty-backfill] order=${oid} failed: ${msg}`);
      }

      if (processed % opts.batchLogEvery === 0) {
        console.log(
          `[loyalty-backfill] progress processed=${processed} success=${success} failed=${failed}`,
        );
      }
    }

    console.log(
      `[loyalty-backfill] done processed=${processed} success=${success} failed=${failed}`,
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
    console.error(`[loyalty-backfill] fatal: ${msg}`);
    process.exit(1);
  });
