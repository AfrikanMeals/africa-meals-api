import { isDemoSeedEnvEnabled } from '@common/security/demo-seed.util';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DeliveryDriverModel,
  DeliveryDriverStatutEnum,
  DeliveryDriverVehiculeEnum,
} from '@schemas/delivery-driver.schema';
import { StoreModel } from '@schemas/store.schema';
import {
  randomLngLatInBbox,
  randomLngLatNearPoint,
  randomPercentCoords,
} from './delivery-driver-geo';

/** Au premier démarrage : un livreur de démo par boutique géolocalisée (max 12). */
@Injectable()
export class DeliveryDriversSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeliveryDriversSeedService.name);

  constructor(
    @InjectModel(DeliveryDriverModel.name)
    private readonly deliveryDriverModel: Model<DeliveryDriverModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
  ) {}

  /**
   * Désactivé par défaut. Activer explicitement : `SEED_DEMO_DELIVERY_DRIVERS=true`.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!isDemoSeedEnvEnabled('SEED_DEMO_DELIVERY_DRIVERS')) {
      return;
    }

    const n = await this.deliveryDriverModel.countDocuments().exec();
    if (n > 0) return;

    const stores = await this.storeModel
      .find({})
      .limit(12)
      .populate({ path: 'address', select: 'location' })
      .lean()
      .exec();

    if (!stores.length) {
      this.logger.log(
        'Seed delivery_drivers : aucune boutique en base, aucun livreur inséré.',
      );
      return;
    }

    let inserted = 0;
    for (const st of stores) {
      const addr = st.address as
        | { location?: { coordinates?: number[] } }
        | undefined;
      const c = addr?.location?.coordinates;
      let longitude: number;
      let latitude: number;
      if (
        Array.isArray(c) &&
        c.length >= 2 &&
        !(Number(c[0]) === 0 && Number(c[1]) === 0)
      ) {
        const p = randomLngLatNearPoint(Number(c[0]), Number(c[1]));
        longitude = p.longitude;
        latitude = p.latitude;
      } else {
        const p = randomLngLatInBbox();
        longitude = p.longitude;
        latitude = p.latitude;
      }
      await this.deliveryDriverModel.create({
        store: st._id,
        nom: 'Livreur démo',
        avatar: '🛵',
        tel: '+000 00 000 00 00',
        statut: DeliveryDriverStatutEnum.DISPONIBLE,
        zone: `Autour de ${String(st.name ?? 'la boutique')}`,
        vehicule: DeliveryDriverVehiculeEnum.MOTO,
        immat: '—',
        note: 4.5,
        livraisons_jour: 0,
        livraisons_total: 0,
        temps_moyen: 22,
        distance_jour: 0,
        revenu_jour: 0,
        capacite: 2,
        commande_en_cours: null,
        coords: randomPercentCoords(),
        longitude,
        latitude,
      });
      inserted += 1;
    }
    this.logger.log(
      `Seed delivery_drivers : ${inserted} livreur(s) de démo (1 par boutique).`,
    );
  }
}
