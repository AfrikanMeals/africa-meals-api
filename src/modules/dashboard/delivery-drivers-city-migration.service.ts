import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DeliveryDriverModel } from '@schemas/delivery-driver.schema';
import { StoreModel } from '@schemas/store.schema';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { randomLngLatInBbox } from './delivery-driver-geo';

type StoreGeo = {
  _id: Types.ObjectId;
  name: string;
  city: string;
  longitude: number;
  latitude: number;
};

function hash01(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return (h % 10000) / 10000;
}

function deterministicNearPoint(
  longitude: number,
  latitude: number,
  seed: string,
  spreadDeg = 0.012,
): { longitude: number; latitude: number } {
  const ux = hash01(`${seed}:x`) - 0.5;
  const uy = hash01(`${seed}:y`) - 0.5;
  return {
    longitude: longitude + ux * spreadDeg,
    latitude: latitude + uy * spreadDeg,
  };
}

function deterministicPercentCoords(seed: string): { x: number; y: number } {
  const x = 12 + hash01(`${seed}:px`) * 76;
  const y = 12 + hash01(`${seed}:py`) * 76;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Migration idempotente:
 * - rattache les livreurs sans boutique a une boutique existante
 * - deplace les livreurs pour qu'ils soient dans la meme ville que leur boutique
 */
@Injectable()
export class DeliveryDriversCityMigrationService
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(
    DeliveryDriversCityMigrationService.name,
  );

  constructor(
    @InjectModel(DeliveryDriverModel.name)
    private readonly deliveryDriverModel: Model<DeliveryDriverModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const drivers = await this.deliveryDriverModel.find({}).lean().exec();
    if (!drivers.length) return;

    const storesRaw = await this.storeModel
      .find({})
      .populate({ path: 'address', select: 'city location' })
      .lean()
      .exec();
    if (!storesRaw.length) return;

    const stores = storesRaw
      .map((s) => {
        const doc = s as Record<string, unknown>;
        const addr = doc.address as
          | { city?: unknown; location?: { coordinates?: unknown[] } }
          | undefined;
        const c = addr?.location?.coordinates;
        const city =
          typeof addr?.city === 'string' && addr.city.trim()
            ? addr.city.trim()
            : 'Ville';
        const name =
          typeof doc.name === 'string' && doc.name.trim()
            ? doc.name.trim()
            : 'Boutique';
        if (
          Array.isArray(c) &&
          c.length >= 2 &&
          Number.isFinite(Number(c[0])) &&
          Number.isFinite(Number(c[1])) &&
          !(Number(c[0]) === 0 && Number(c[1]) === 0)
        ) {
          return {
            _id: doc._id as Types.ObjectId,
            name,
            city,
            longitude: Number(c[0]),
            latitude: Number(c[1]),
          } as StoreGeo;
        }
        const fallback = randomLngLatInBbox();
        return {
          _id: doc._id as Types.ObjectId,
          name,
          city,
          longitude: fallback.longitude,
          latitude: fallback.latitude,
        } as StoreGeo;
      })
      .filter(Boolean);

    if (!stores.length) return;
    const storeMap = new Map(stores.map((s) => [String(s._id), s]));

    let orphanAssigned = 0;
    const ops: AnyBulkWriteOperation<DeliveryDriverModel>[] = [];
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i] as unknown as {
        _id: Types.ObjectId;
        store?: Types.ObjectId;
      };
      let targetStore: StoreGeo | undefined;
      if (d.store) {
        targetStore = storeMap.get(String(d.store));
      }
      if (!targetStore) {
        targetStore = stores[i % stores.length];
        orphanAssigned += 1;
      }
      const p = deterministicNearPoint(
        targetStore.longitude,
        targetStore.latitude,
        `${String(d._id)}:${String(targetStore._id)}`,
      );
      ops.push({
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: {
              store: targetStore._id,
              longitude: p.longitude,
              latitude: p.latitude,
              coords: deterministicPercentCoords(String(d._id)),
              zone: `${targetStore.city} / ${targetStore.name}`,
            },
          },
        },
      });
    }

    if (!ops.length) return;
    await this.deliveryDriverModel.bulkWrite(ops);
    this.logger.log(
      `Migration livreurs: ${ops.length} livreur(s) repositionne(s), ${orphanAssigned} rattache(s) a une boutique.`,
    );
  }
}
