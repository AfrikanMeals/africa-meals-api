import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AddressModel } from '@schemas/address.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { ShippingQuoteDto } from './dto/shipping-quote.dto';
import { PlatformShippingSettingsService } from './platform-shipping-settings.service';
import {
  computePlatformShippingFeeFromDistance,
  extractLatLonFromGeoPoint,
} from './shipping-quote.util';
import { resolvePlatformShippingRegionCode } from './platform-shipping-region.util';
import { countryCodeFromStoreRegion } from '@modules/supported-countries/region-tax.util';
import { DrivingDistanceService } from '@modules/route-optimization/driving-distance.service';

@Injectable()
export class PlatformShippingQuoteService {
  constructor(
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    @InjectModel(UserModel.name)
    private readonly _userModel: Model<UserModel>,
    @InjectModel(AddressModel.name)
    private readonly _addressModel: Model<AddressModel>,
    private readonly _settingsService: PlatformShippingSettingsService,
    // SoT distance routière (Google Distance Matrix prioritaire).
    private readonly _drivingDistance: DrivingDistanceService,
  ) {}

  async quoteForUser(user: UserModel, dto: ShippingQuoteDto) {
    // Cadeau : l’adresse appartient au destinataire, pas au JWT payeur.
    const giftRecipientId = String(dto.giftRecipientUserId ?? '').trim();
    const addressOwnerId = giftRecipientId || user._id.toString();
    if (giftRecipientId) {
      if (giftRecipientId === user._id.toString()) {
        throw new BadRequestException('cannot_gift_self');
      }
      if (!Types.ObjectId.isValid(giftRecipientId)) {
        throw new BadRequestException('gift_recipient_invalid');
      }
    }
    const userDoc = await this._userModel
      .findById(addressOwnerId)
      .select('addresses')
      .lean()
      .exec();
    const addrRefs = (userDoc?.addresses ?? []) as unknown[];
    const owned = addrRefs.some((aid) => aid?.toString() === dto.addressId);
    if (!owned) {
      throw new ForbiddenException('address_not_owned');
    }

    const deliveryAddr = await this._addressModel
      .findById(dto.addressId)
      .select('location countryCode')
      .lean()
      .exec();
    if (!deliveryAddr) {
      throw new NotFoundException('address_not_found');
    }
    const store = await this._storeModel
      .findById(dto.storeId)
      .populate({ path: 'address', select: 'location countryCode' })
      .select('region address')
      .lean()
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    const shopAddr = store.address as
      | {
          location?: { type?: string; coordinates?: number[] };
          countryCode?: string;
        }
      | null
      | undefined;
    const storeAddrCc =
      shopAddr && typeof shopAddr === 'object' && !Array.isArray(shopAddr)
        ? String(shopAddr.countryCode ?? '').trim().toUpperCase()
        : '';
    const regionCode = resolvePlatformShippingRegionCode([
      store.region,
      countryCodeFromStoreRegion(store),
      storeAddrCc,
      deliveryAddr?.countryCode,
      user.appCountryCode,
    ]);
    const settings = await this._settingsService.getPublicSettings(regionCode);

    const dest = extractLatLonFromGeoPoint(
      deliveryAddr.location as {
        type?: string;
        coordinates?: number[];
      },
    );
    if (!dest) {
      return this._undeliverableQuote(dto, settings, {
        reason: 'delivery_address_missing_coordinates',
      });
    }

    const origin = extractLatLonFromGeoPoint(shopAddr?.location);
    if (!origin) {
      return this._undeliverableQuote(dto, settings, {
        reason: 'store_address_missing_coordinates',
      });
    }

    // Fix: Haversine (vol d’oiseau) sous-facturait vs Gmaps (~2,85 vs 4,6 km).
    const billed = await this._drivingDistance.resolveBillableDistanceKm({
      origin,
      dest,
    });
    const distanceKm = billed.distanceKm;
    const computed = computePlatformShippingFeeFromDistance(
      settings,
      distanceKm,
    );

    return {
      storeId: dto.storeId,
      addressId: dto.addressId,
      distanceKm,
      // Champs additifs : debug / QA (clients existants ignorent).
      distanceSource: billed.source,
      routingEngine: billed.engine,
      maxDeliveryRadiusKm: settings.maxDeliveryRadiusKm,
      deliverable: computed.deliverable,
      fee: computed.deliverable ? computed.total : null,
      resolvedRegionCode: regionCode ?? null,
      undeliverableReason: computed.deliverable
        ? null
        : 'beyond_delivery_radius',
      breakdown: {
        rangeFlat: computed.rangeFlat,
        rangePerKmRate: computed.rangePerKmRate || null,
        deliveryBasePrice: computed.deliveryBasePrice,
        perKmRate: computed.perKmRateEffective,
        perKmComponent: computed.perKmComponent,
        total: computed.deliverable ? computed.total : null,
      },
    };
  }

  private _undeliverableQuote(
    dto: ShippingQuoteDto,
    settings: Awaited<
      ReturnType<PlatformShippingSettingsService['getPublicSettings']>
    >,
    opts: { reason: string },
  ) {
    return {
      storeId: dto.storeId,
      addressId: dto.addressId,
      distanceKm: null,
      distanceSource: null,
      routingEngine: null,
      maxDeliveryRadiusKm: settings?.maxDeliveryRadiusKm ?? null,
      deliverable: false,
      fee: null,
      resolvedRegionCode: null,
      undeliverableReason: opts.reason,
      breakdown: {
        rangeFlat: null,
        rangePerKmRate: null,
        deliveryBasePrice: null,
        perKmRate: settings?.perKmRate ?? null,
        perKmComponent: null,
        total: null,
      },
    };
  }
}
