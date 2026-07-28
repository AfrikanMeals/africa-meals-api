import { NestFactory } from '@nestjs/core';
import { MediaUrlNormalizeService } from '@modules/storage-settings/media-url-normalize.service';
import { AppModule } from '../app.module';

/**
 * Réécrit les URLs médias stockées en base vers ce que l'API sert aujourd'hui.
 *
 * À lancer après avoir coché « Block all public access » sur le bucket S3 :
 * les URLs directes `bucket.s3.….amazonaws.com` deviennent `/medias/public/…`.
 *
 *   npm run medias:normalize-urls            # simulation (aucune écriture)
 *   npm run medias:normalize-urls -- --apply # applique les mises à jour
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
