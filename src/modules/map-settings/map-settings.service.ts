import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MapSettingsDocument,
  MapSettingsModel,
} from '@schemas/map-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateMapSettingsDto } from './dto/update-map-settings.dto';

const SETTINGS_KEY = 'default';

type VendorEngine = 'mapbox' | 'google' | 'osm';
type MobileEngine = 'mapbox' | 'google' | 'osm';
type GeocodingEngine = 'mapbox' | 'google' | 'osm';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function assertAtLeastOneEngine(
  mapbox: boolean,
  google: boolean,
  osm: boolean,
  scope: string,
) {
  if (!mapbox && !google && !osm) {
    throw new BadRequestException(`at_least_one_map_engine_required_${scope}`);
  }
}

function normalizeVendorDefault(raw: unknown): VendorEngine {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'google') return 'google';
  if (v === 'mapbox') return 'mapbox';
  return 'osm';
}

function normalizeMobileDefault(raw: unknown): MobileEngine {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'google') return 'google';
  if (v === 'mapbox') return 'mapbox';
  return 'osm';
}

function normalizeGeocodingEngine(raw: unknown): GeocodingEngine {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'google') return 'google';
  if (v === 'mapbox') return 'mapbox';
  return 'osm';
}

function assertDefaultEngineEnabled(
  engine: string,
  mapbox: boolean,
  google: boolean,
  osm: boolean,
  scope: string,
) {
  const normalized = String(engine ?? '').trim().toLowerCase();
  const enabled =
    (normalized === 'mapbox' && mapbox) ||
    (normalized === 'google' && google) ||
    (normalized === 'osm' && osm);
  if (!enabled) {
    throw new BadRequestException(`default_map_engine_not_enabled_${scope}`);
  }
}

@Injectable()
export class MapSettingsService {
  constructor(
    @InjectModel(MapSettingsModel.name)
    private readonly _settings: Model<MapSettingsDocument>,
  ) {}

  private _toResponse(doc: MapSettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    const vendorDefault = normalizeVendorDefault(doc.vendorDefaultMapEngine);
    const mobileUserDefault = normalizeMobileDefault(
      doc.mobileUserDefaultMapEngine,
    );
    const mobileDeliveryDefault = normalizeMobileDefault(
      doc.mobileDeliveryDefaultMapEngine,
    );
    return {
      vendor: {
        mapboxEnabled: doc.vendorMapboxEnabled !== false,
        googleEnabled: doc.vendorGoogleEnabled !== false,
        osmEnabled: doc.vendorOsmEnabled !== false,
        defaultMapEngine: vendorDefault,
        geocodingEngine: normalizeGeocodingEngine(doc.vendorGeocodingEngine),
      },
      mobileUser: {
        mapboxEnabled: doc.mobileUserMapboxEnabled !== false,
        googleEnabled: doc.mobileUserGoogleEnabled !== false,
        osmEnabled: doc.mobileUserOsmEnabled !== false,
        defaultMapEngine: mobileUserDefault,
        geocodingEngine: normalizeGeocodingEngine(doc.mobileUserGeocodingEngine),
      },
      mobileDelivery: {
        mapboxEnabled: doc.mobileDeliveryMapboxEnabled !== false,
        googleEnabled: doc.mobileDeliveryGoogleEnabled !== false,
        osmEnabled: doc.mobileDeliveryOsmEnabled !== false,
        defaultMapEngine: mobileDeliveryDefault,
        geocodingEngine: normalizeGeocodingEngine(
          doc.mobileDeliveryGeocodingEngine,
        ),
      },
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getPublicSettings() {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            vendorMapboxEnabled: true,
            vendorGoogleEnabled: false,
            vendorOsmEnabled: true,
            vendorDefaultMapEngine: 'osm',
            mobileUserMapboxEnabled: true,
            mobileUserGoogleEnabled: true,
            mobileUserOsmEnabled: true,
            mobileUserDefaultMapEngine: 'osm',
            mobileDeliveryMapboxEnabled: true,
            mobileDeliveryGoogleEnabled: true,
            mobileDeliveryOsmEnabled: true,
            mobileDeliveryDefaultMapEngine: 'osm',
            vendorGeocodingEngine: 'osm',
            mobileUserGeocodingEngine: 'osm',
            mobileDeliveryGeocodingEngine: 'osm',
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    const base = this._toResponse(doc as MapSettingsModel);
    // Client & livreur mobile : tous les moteurs d’affichage (formule boutique sans effet).
    return {
      ...base,
      mobileUser: {
        ...base.mobileUser,
        mapboxEnabled: true,
        googleEnabled: true,
        osmEnabled: true,
      },
      mobileDelivery: {
        ...base.mobileDelivery,
        mapboxEnabled: true,
        googleEnabled: true,
        osmEnabled: true,
      },
    };
  }

  async updateSettings(user: UserModel, dto: UpdateMapSettingsDto) {
    assertAdmin(user);
    assertAtLeastOneEngine(
      dto.vendorMapboxEnabled,
      dto.vendorGoogleEnabled,
      dto.vendorOsmEnabled,
      'vendor',
    );
    assertAtLeastOneEngine(
      dto.mobileUserMapboxEnabled,
      dto.mobileUserGoogleEnabled,
      dto.mobileUserOsmEnabled,
      'mobile_user',
    );
    assertAtLeastOneEngine(
      dto.mobileDeliveryMapboxEnabled,
      dto.mobileDeliveryGoogleEnabled,
      dto.mobileDeliveryOsmEnabled,
      'mobile_delivery',
    );

    const existing = await this._settings
      .findOne({ key: SETTINGS_KEY })
      .lean()
      .exec();

    const vendorDefault = normalizeVendorDefault(
      dto.vendorDefaultMapEngine ??
        (existing as MapSettingsModel | null)?.vendorDefaultMapEngine,
    );
    const mobileUserDefault = normalizeMobileDefault(
      dto.mobileUserDefaultMapEngine ??
        (existing as MapSettingsModel | null)?.mobileUserDefaultMapEngine,
    );
    const mobileDeliveryDefault = normalizeMobileDefault(
      dto.mobileDeliveryDefaultMapEngine ??
        (existing as MapSettingsModel | null)?.mobileDeliveryDefaultMapEngine,
    );
    const vendorGeocoding = normalizeGeocodingEngine(
      dto.vendorGeocodingEngine ??
        (existing as MapSettingsModel | null)?.vendorGeocodingEngine,
    );
    const mobileUserGeocoding = normalizeGeocodingEngine(
      dto.mobileUserGeocodingEngine ??
        (existing as MapSettingsModel | null)?.mobileUserGeocodingEngine,
    );
    const mobileDeliveryGeocoding = normalizeGeocodingEngine(
      dto.mobileDeliveryGeocodingEngine ??
        (existing as MapSettingsModel | null)?.mobileDeliveryGeocodingEngine,
    );

    assertDefaultEngineEnabled(
      vendorDefault,
      dto.vendorMapboxEnabled,
      dto.vendorGoogleEnabled,
      dto.vendorOsmEnabled,
      'vendor',
    );
    assertDefaultEngineEnabled(
      mobileUserDefault,
      dto.mobileUserMapboxEnabled,
      dto.mobileUserGoogleEnabled,
      dto.mobileUserOsmEnabled,
      'mobile_user',
    );
    assertDefaultEngineEnabled(
      mobileDeliveryDefault,
      dto.mobileDeliveryMapboxEnabled,
      dto.mobileDeliveryGoogleEnabled,
      dto.mobileDeliveryOsmEnabled,
      'mobile_delivery',
    );

    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            vendorMapboxEnabled: dto.vendorMapboxEnabled,
            vendorGoogleEnabled: dto.vendorGoogleEnabled,
            vendorOsmEnabled: dto.vendorOsmEnabled,
            vendorDefaultMapEngine: vendorDefault,
            mobileUserMapboxEnabled: dto.mobileUserMapboxEnabled,
            mobileUserGoogleEnabled: dto.mobileUserGoogleEnabled,
            mobileUserOsmEnabled: dto.mobileUserOsmEnabled,
            mobileUserDefaultMapEngine: mobileUserDefault,
            mobileDeliveryMapboxEnabled: dto.mobileDeliveryMapboxEnabled,
            mobileDeliveryGoogleEnabled: dto.mobileDeliveryGoogleEnabled,
            mobileDeliveryOsmEnabled: dto.mobileDeliveryOsmEnabled,
            mobileDeliveryDefaultMapEngine: mobileDeliveryDefault,
            vendorGeocodingEngine: vendorGeocoding,
            mobileUserGeocodingEngine: mobileUserGeocoding,
            mobileDeliveryGeocodingEngine: mobileDeliveryGeocoding,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
