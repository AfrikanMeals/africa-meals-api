/**
 * Migration one-shot : delivery_assignment_mode AUTO → SEMI_AUTO.
 *
 * Contexte : avant ce changement, AUTO = claim livreur + cascade d’offres.
 * Après : AUTO = hard-assign système ; SEMI_AUTO = ancien AUTO.
 * Sans migration, toutes les boutiques « Automatique » passeraient en hard-assign.
 *
 * Usage :
 *   yarn ts-node -r tsconfig-paths/register src/scripts/migrate-delivery-assignment-auto-to-semi.ts
 *   yarn ts-node -r tsconfig-paths/register src/scripts/migrate-delivery-assignment-auto-to-semi.ts --apply
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import {
  StoreDeliveryAssignmentModeEnum,
  StoreModel,
} from '@schemas/store.schema';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const stores = app.get<Model<StoreModel>>(getModelToken(StoreModel.name));
    const filter = { deliveryAssignmentMode: StoreDeliveryAssignmentModeEnum.AUTO };
    const count = await stores.countDocuments(filter).exec();
    console.log(
      `[migrate-delivery-assignment] boutiques AUTO à migrer → SEMI_AUTO : ${count}`,
    );
    if (!apply) {
      console.log(
        '[migrate-delivery-assignment] dry-run (ajoute --apply pour écrire)',
      );
      return;
    }
    const result = await stores
      .updateMany(filter, {
        $set: {
          deliveryAssignmentMode: StoreDeliveryAssignmentModeEnum.SEMI_AUTO,
        },
      })
      .exec();
    console.log(
      `[migrate-delivery-assignment] modifié=${result.modifiedCount} matched=${result.matchedCount}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
