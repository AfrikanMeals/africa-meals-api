import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreModel } from '@schemas/store.schema';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';

export type StoreRegionBackfillResult = {
  candidates: number;
  updated: number;
  skippedNoAddress: number;
  skippedInvalidCountry: number;
  dryRun: boolean;
};

function normalizeIso2(raw: unknown): string {
  const cc = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : '';
}

function countryCodeFromPopulatedAddress(addr: unknown): string {
  if (!addr || typeof addr !== 'object' || Array.isArray(addr)) return '';
  const doc = addr as Record<string, unknown>;
  return normalizeIso2(doc.countryCode ?? doc.country_code);
}

/**
 * Migration idempotente : remplit `stores.region` depuis `address.countryCode`
 * pour les boutiques existantes sans région enregistrée.
 */
@Injectable()
export class StoreRegionBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StoreRegionBackfillService.name);

  constructor(
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Le script CLI gère lui-même l’exécution (dry-run / --apply).
    if (process.argv.some((arg) => arg.includes('store-region-backfill'))) {
      return;
    }
    const result = await this.backfill({ dryRun: false });
    if (result.updated > 0) {
      this.logger.log(
        `Région boutique : ${result.updated} restaurant(s) prérempli(s) depuis l’adresse.`,
      );
    }
  }

  async backfill(args?: { dryRun?: boolean }): Promise<StoreRegionBackfillResult> {
    const dryRun = args?.dryRun ?? false;

    const stores = await this.storeModel
      .find({
        $or: [
          { region: { $exists: false } },
          { region: null },
          { region: '' },
        ],
      })
      .populate({ path: 'address', select: 'countryCode country_code' })
      .select('_id name region address')
      .lean()
      .exec();

    const ops: AnyBulkWriteOperation<StoreModel>[] = [];
    let skippedNoAddress = 0;
    let skippedInvalidCountry = 0;

    for (const row of stores) {
      const doc = row as Record<string, unknown>;
      const cc = countryCodeFromPopulatedAddress(doc.address);
      if (!doc.address) {
        skippedNoAddress += 1;
        continue;
      }
      if (!cc) {
        skippedInvalidCountry += 1;
        continue;
      }
      ops.push({
        updateOne: {
          filter: { _id: doc._id as Types.ObjectId },
          update: { $set: { region: cc } },
        },
      });
    }

    if (!dryRun && ops.length > 0) {
      await this.storeModel.bulkWrite(ops);
    }

    return {
      candidates: stores.length,
      updated: ops.length,
      skippedNoAddress,
      skippedInvalidCountry,
      dryRun,
    };
  }
}
