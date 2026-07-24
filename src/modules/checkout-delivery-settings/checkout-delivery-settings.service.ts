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
  toCheckoutDeliverySettingsResponse,
} from './checkout-delivery-settings.util';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class CheckoutDeliverySettingsService {
  constructor(
    @InjectModel(CheckoutDeliverySettingsModel.name)
    private readonly _settings: Model<CheckoutDeliverySettingsDocument>,
  ) {}

  private async ensureDoc(): Promise<CheckoutDeliverySettingsModel> {
    // Upsert singleton : défaut false = ne pas masquer Livraison sans coursier.
    const doc = await this._settings
      .findOneAndUpdate(
        { key: CHECKOUT_DELIVERY_SETTINGS_KEY },
        {
          $setOnInsert: {
            key: CHECKOUT_DELIVERY_SETTINGS_KEY,
            hideDeliveryWhenNoCourierAvailable: false,
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

  async updateSettings(user: UserModel, dto: UpdateCheckoutDeliverySettingsDto) {
    assertAdmin(user);
    const patch: Record<string, unknown> = {};
    // Admin envoie toujours le booléen ; normaliser true strict (reste → false).
    if (dto.hideDeliveryWhenNoCourierAvailable !== undefined) {
      patch.hideDeliveryWhenNoCourierAvailable =
        dto.hideDeliveryWhenNoCourierAvailable === true;
    }
    // Fix: $set + $setOnInsert sur le même path → 500 Mongo au 1er upsert (ex. après restart sans GET).
    const doc = await this._settings
      .findOneAndUpdate(
        { key: CHECKOUT_DELIVERY_SETTINGS_KEY },
        buildCheckoutDeliverySettingsUpsertUpdate(patch),
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return toCheckoutDeliverySettingsResponse(
      doc as CheckoutDeliverySettingsModel,
    );
  }
}
