import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CheckoutDeliverySettingsDocument,
  CheckoutDeliverySettingsModel,
} from '@schemas/checkout-delivery-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateCheckoutDeliverySettingsDto } from './dto/update-checkout-delivery-settings.dto';
import {
  buildCheckoutDeliverySettingsUpsertUpdate,
  CHECKOUT_DELIVERY_SETTINGS_KEY,
  DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
  normalizeCourierNearCustomerRadiusMeters,
  toCheckoutDeliverySettingsResponse,
} from './checkout-delivery-settings.util';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

/** Cache court rayon géofence — hot path GPS livreur. */
const RADIUS_CACHE_TTL_MS = 30_000;

@Injectable()
export class CheckoutDeliverySettingsService {
  private radiusCache: { value: number; at: number } | null = null;

  constructor(
    @InjectModel(CheckoutDeliverySettingsModel.name)
    private readonly _settings: Model<CheckoutDeliverySettingsDocument>,
  ) {}

  private invalidateRadiusCache(): void {
    this.radiusCache = null;
  }

  private async ensureDoc(): Promise<CheckoutDeliverySettingsModel> {
    // Upsert singleton : défaut false = ne pas masquer Livraison sans coursier.
    const doc = await this._settings
      .findOneAndUpdate(
        { key: CHECKOUT_DELIVERY_SETTINGS_KEY },
        {
          $setOnInsert: {
            key: CHECKOUT_DELIVERY_SETTINGS_KEY,
            hideDeliveryWhenNoCourierAvailable: false,
            courierNearCustomerRadiusMeters:
              DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as CheckoutDeliverySettingsModel;
  }

  async getPublicSettings() {
    const doc = await this.ensureDoc();
    return toCheckoutDeliverySettingsResponse(doc);
  }

  /** Lecture métier : true uniquement si le flag est explicitement activé. */
  async isHideDeliveryWhenNoCourierAvailable(): Promise<boolean> {
    const doc = await this.ensureDoc();
    return Boolean(doc.hideDeliveryWhenNoCourierAvailable);
  }

  /**
   * Rayon alerte « livreur proche » (mètres), défaut 500.
   * Cache 30 s pour ne pas hammer Mongo sur chaque tick GPS.
   */
  async getCourierNearCustomerRadiusMeters(): Promise<number> {
    const now = Date.now();
    if (
      this.radiusCache &&
      now - this.radiusCache.at < RADIUS_CACHE_TTL_MS
    ) {
      return this.radiusCache.value;
    }
    const doc = await this.ensureDoc();
    const value = normalizeCourierNearCustomerRadiusMeters(
      doc.courierNearCustomerRadiusMeters,
    );
    this.radiusCache = { value, at: now };
    return value;
  }

  async updateSettings(user: UserModel, dto: UpdateCheckoutDeliverySettingsDto) {
    assertAdmin(user);
    const patch: Record<string, unknown> = {};
    // Admin envoie toujours le booléen ; normaliser true strict (reste → false).
    if (dto.hideDeliveryWhenNoCourierAvailable !== undefined) {
      patch.hideDeliveryWhenNoCourierAvailable =
        dto.hideDeliveryWhenNoCourierAvailable === true;
    }
    if (dto.courierNearCustomerRadiusMeters !== undefined) {
      patch.courierNearCustomerRadiusMeters =
        normalizeCourierNearCustomerRadiusMeters(
          dto.courierNearCustomerRadiusMeters,
        );
    }
    // Fix: $set + $setOnInsert sur le même path → 500 Mongo au 1er upsert (ex. après restart sans GET).
    const doc = await this._settings
      .findOneAndUpdate(
        { key: CHECKOUT_DELIVERY_SETTINGS_KEY },
        buildCheckoutDeliverySettingsUpsertUpdate(patch),
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    // Nouveau rayon immédiat pour le prochain tick GPS.
    this.invalidateRadiusCache();
    return toCheckoutDeliverySettingsResponse(
      doc as CheckoutDeliverySettingsModel,
    );
  }
}
