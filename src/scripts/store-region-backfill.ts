import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StoreRegionBackfillService } from '@modules/store/store-region-backfill.service';

async function run() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const backfill = app.get(StoreRegionBackfillService);
    const result = await backfill.backfill({ dryRun: !apply });

    console.log(
      `[store-region-backfill] candidates=${result.candidates} wouldUpdate=${result.updated} skippedNoAddress=${result.skippedNoAddress} skippedInvalidCountry=${result.skippedInvalidCountry} apply=${apply}`,
    );

    if (!apply) {
      console.log(
        '[store-region-backfill] dry-run only. Re-run with --apply to persist.',
      );
    }
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
    console.error(`[store-region-backfill] fatal: ${msg}`);
    process.exit(1);
  });
