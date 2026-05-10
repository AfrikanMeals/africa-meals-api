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
import { Model } from 'mongoose';
import { ShippingQuoteDto } from './dto/shipping-quote.dto';
import { PlatformShippingSettingsService } from './platform-shipping-settings.service';
import {
  computePlatformShippingFeeFromDistance,
  extractLatLonFromGeoPoint,
  haversineDistanceKm,
} from './shipping-quote.util';

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
  ) {}

  async quoteForUser(user: UserModel, dto: ShippingQuoteDto) {
    const userDoc = await this._userModel
      .findById(user._id)
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
      .select('location')
      .lean()
      .exec();
    if (!deliveryAddr) {
      throw new NotFoundException('address_not_found');
    }
    const dest = extractLatLonFromGeoPoint(
      deliveryAddr.location as {
        type?: string;
        coordinates?: number[];
      },
    );
    if (!dest) {
      throw new BadRequestException('delivery_address_missing_coordinates');
    }

    const store = await this._storeModel
      .findById(dto.storeId)
      .populate({ path: 'address', select: 'location' })
      .lean()
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    const shopAddr = store.address as
      | { location?: { type?: string; coordinates?: number[] } }
      | null
      | undefined;
    const origin = extractLatLonFromGeoPoint(shopAddr?.location);
    if (!origin) {
      throw new BadRequestException('store_address_missing_coordinates');
    }

    const distanceKm = haversineDistanceKm(
      origin.lat,
      origin.lon,
      dest.lat,
      dest.lon,
    );
    const settings = await this._settingsService.getPublicSettings();
    const computed = computePlatformShippingFeeFromDistance(
      settings,
      distanceKm,
    );

    const distanceRounded = Math.round(distanceKm * 1000) / 1000;

    return {
      storeId: dto.storeId,
      addressId: dto.addressId,
      distanceKm: distanceRounded,
      maxDeliveryRadiusKm: settings.maxDeliveryRadiusKm,
      deliverable: computed.deliverable,
      fee: computed.deliverable ? computed.total : null,
      breakdown: {
        rangeFlat: computed.rangeFlat,
        perKmRate: settings.perKmRate,
        perKmComponent: computed.perKmComponent,
        total: computed.deliverable ? computed.total : null,
      },
    };
  }
}
