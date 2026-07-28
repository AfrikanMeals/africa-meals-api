import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { MediasService } from '@modules/medias/medias.service';
import { Connection } from 'mongoose';
import { buildDocumentMediaUrlUpdates } from './media-url-normalize.util';
import { STORAGE_MEDIA_TARGETS } from './storage-media-inventory.constants';

export type MediaUrlNormalizeResult = {
  scannedDocuments: number;
  changedDocuments: number;
  changedFields: number;
  byCollection: Record<string, number>;
};

/**
 * Aligne les URLs médias stockées en base sur ce que l'API sert aujourd'hui.
 *
 * Cas d'usage : bascule d'un bucket S3 en « Block all public access ». Les documents
 * créés avant la bascule contiennent des URLs `bucket.s3.….amazonaws.com` qui
 * renverraient 403 ; on les réécrit vers le proxy `GET /medias/public/…`.
 *
 * Idempotent : `resolvePublicMediaUrl` renvoie l'URL inchangée quand le bucket est
 * encore public, donc un run à vide ne modifie rien.
 */
@Injectable()
export class MediaUrlNormalizeService {
  private readonly logger = new Logger(MediaUrlNormalizeService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly medias: MediasService,
  ) {}

  async normalize(
    options: { dryRun?: boolean } = {},
  ): Promise<MediaUrlNormalizeResult> {
    const dryRun = options.dryRun !== false;
    const result: MediaUrlNormalizeResult = {
      scannedDocuments: 0,
      changedDocuments: 0,
      changedFields: 0,
      byCollection: {},
    };

    const rewrite = (url: string) => this.medias.resolvePublicMediaUrl(url);

    for (const target of STORAGE_MEDIA_TARGETS) {
      const collection = this.connection.db.collection(target.collection);
      const cursor = collection.find(
        {},
        { projection: this.buildProjection(target) },
      );

      for await (const doc of cursor) {
        result.scannedDocuments++;
        const updates = await buildDocumentMediaUrlUpdates(
          doc as Record<string, unknown>,
          target.fields,
          rewrite,
        );
        const paths = Object.keys(updates);
        if (paths.length === 0) continue;

        result.changedDocuments++;
        result.changedFields += paths.length;
        result.byCollection[target.collection] =
          (result.byCollection[target.collection] ?? 0) + paths.length;

        // En dry-run on compte sans écrire : permet de valider le volume avant prod.
        if (dryRun) continue;
        await collection.updateOne({ _id: doc._id }, { $set: updates });
      }
    }

    this.logger.log(
      `media-url-normalize dryRun=${dryRun} scanned=${result.scannedDocuments} changedDocs=${result.changedDocuments} changedFields=${result.changedFields}`,
    );
    return result;
  }

  /** Ne charger que les champs médias : les collections produits sont volumineuses. */
  private buildProjection(
    target: (typeof STORAGE_MEDIA_TARGETS)[number],
  ): Record<string, 1> {
    const projection: Record<string, 1> = { _id: 1 };
    for (const field of target.fields) {
      if (field.kind === 'array') projection[field.arrayField] = 1;
      else projection[field.field] = 1;
    }
    return projection;
  }
}
