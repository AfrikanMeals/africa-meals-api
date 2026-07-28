import { NestFactory } from '@nestjs/core';
import { MediaUrlNormalizeService } from '@modules/storage-settings/media-url-normalize.service';
import { AppModule } from '../app.module';

/**
 * Réécrit les URLs médias stockées en base vers ce que l'API sert aujourd'hui.
 *
 * À lancer après avoir coché « Block all public access » sur le bucket S3 :
 * les URLs directes `bucket.s3.….amazonaws.com` deviennent `/medias/public/…`.
 *
 * Prod VPS : exécuter dans le pod API (image Docker déjà buildée), pas sur l’hôte
 * `/opt/wise-eat-api` (pas de nest / tsconfig-paths en install --omit=dev) :
 *   kubectl exec … -- node dist/scripts/media-url-normalize.js
 *   kubectl exec … -- node dist/scripts/media-url-normalize.js --apply
 *
 * Local (après `npm run build`) :
 *   npm run medias:normalize-urls            # dry-run
 *   npm run medias:normalize-urls -- --apply
 *
 * Dev (sources TypeScript) :
 *   npm run medias:normalize-urls:src -- --apply
 */
async function run() {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const normalizer = app.get(MediaUrlNormalizeService);
    const result = await normalizer.normalize({ dryRun: !apply });

    console.log(
      `[media-url-normalize] scanned=${result.scannedDocuments} changedDocs=${result.changedDocuments} changedFields=${result.changedFields} apply=${apply}`,
    );
    for (const [collection, count] of Object.entries(result.byCollection)) {
      console.log(`[media-url-normalize]   ${collection}: ${count} champ(s)`);
    }

    if (!apply) {
      console.log(
        '[media-url-normalize] dry-run only. Re-run with --apply to persist.',
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
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[media-url-normalize] fatal: ${msg}`);
    process.exit(1);
  });
