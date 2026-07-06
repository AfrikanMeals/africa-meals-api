import { MapGeocodeUsageTracker } from '@common/map-geocode/map-geocode-usage.tracker';
import type { MapGeocodeRuntimeUsageSnapshot } from '@common/map-geocode/map-geocode-usage.types';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  GeocodeCacheEntryDocument,
  GeocodeCacheEntryModel,
} from '@schemas/geocode-cache-entry.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { MapSettingsService } from './map-settings.service';

export type MapGeocodeCacheAggregateRow = {
  key: string;
  entries: number;
  hits: number;
};

export type MapGeocodeUsageStatsResponse = {
  generatedAt: string;
  runtime: MapGeocodeRuntimeUsageSnapshot;
  cache: {
    mongoEntries: number;
    mongoHitsTotal: number;
    byEngine: MapGeocodeCacheAggregateRow[];
    byKind: MapGeocodeCacheAggregateRow[];
  };
  configured: {
    mapDisplay: {
      vendor: { mapbox: boolean; google: boolean; osm: boolean; defaultEngine: string };
      mobileUser: { mapbox: boolean; google: boolean; osm: boolean; defaultEngine: string };
      mobileDelivery: {
        mapbox: boolean;
        google: boolean;
        osm: boolean;
        defaultEngine: string;
      };
    };
    geocodingPools: {
      vendor: Array<{ engine: string; weight: number }>;
      mobileUser: Array<{ engine: string; weight: number }>;
      mobileDelivery: Array<{ engine: string; weight: number }>;
    };
    geocodeCache: {
      storePriority: string[];
      storeAvailability: Record<string, boolean>;
    };
  };
  notes: string[];
};

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class MapGeocodeUsageService {
  constructor(
    private readonly tracker: MapGeocodeUsageTracker,
    private readonly mapSettings: MapSettingsService,
    @InjectModel(GeocodeCacheEntryModel.name)
    private readonly geocodeCache: Model<GeocodeCacheEntryDocument>,
  ) {}

  async getStats(user: UserModel): Promise<MapGeocodeUsageStatsResponse> {
    assertAdmin(user);

    const [runtime, cacheAgg, publicSettings] = await Promise.all([
      Promise.resolve(this.tracker.snapshot()),
      this.aggregateMongoCache(),
      this.mapSettings.getPublicSettings(),
    ]);

    const mapGroup = (
      group: (typeof publicSettings)['vendor'],
    ): MapGeocodeUsageStatsResponse['configured']['mapDisplay']['vendor'] => ({
      mapbox: group.mapboxEnabled !== false,
      google: group.googleEnabled !== false,
      osm: group.osmEnabled !== false,
      defaultEngine: String(group.defaultMapEngine ?? 'osm'),
    });

    return {
      generatedAt: new Date().toISOString(),
      runtime,
      cache: cacheAgg,
      configured: {
        mapDisplay: {
          vendor: mapGroup(publicSettings.vendor),
          mobileUser: mapGroup(publicSettings.mobileUser),
          mobileDelivery: mapGroup(publicSettings.mobileDelivery),
        },
        geocodingPools: {
          vendor: [],
          mobileUser: publicSettings.mobileUser.geocodingEnginePool ?? [],
          mobileDelivery: publicSettings.mobileDelivery.geocodingEnginePool ?? [],
        },
        geocodeCache: {
          storePriority: publicSettings.geocodeCache?.storePriority ?? [],
          storeAvailability: publicSettings.geocodeCache?.storeAvailability ?? {},
        },
      },
      notes: [
        'Les compteurs « processus API » sont remis à zéro au redémarrage du serveur.',
        'Le pool géocodage vendeur est configuré par formule d’abonnement (non listé ici).',
        'Les tuiles carte et itinéraires côté client (Mapbox, Google, OSM) ne passent pas par l’API : non comptabilisés ici.',
        'Les hits cache MongoDB incluent l’historique persistant (toutes instances).',
      ],
    };
  }

  private async aggregateMongoCache(): Promise<
    MapGeocodeUsageStatsResponse['cache']
  > {
    const [totals, byEngine, byKind] = await Promise.all([
      this.geocodeCache
        .aggregate<{ entries: number; hits: number }>([
          {
            $group: {
              _id: null,
              entries: { $sum: 1 },
              hits: { $sum: { $ifNull: ['$hitCount', 0] } },
            },
          },
        ])
        .exec(),
      this.geocodeCache
        .aggregate<{ _id: string; entries: number; hits: number }>([
          {
            $group: {
              _id: '$engine',
              entries: { $sum: 1 },
              hits: { $sum: { $ifNull: ['$hitCount', 0] } },
            },
          },
          { $sort: { hits: -1, entries: -1 } },
        ])
        .exec(),
      this.geocodeCache
        .aggregate<{ _id: string; entries: number; hits: number }>([
          {
            $group: {
              _id: '$kind',
              entries: { $sum: 1 },
              hits: { $sum: { $ifNull: ['$hitCount', 0] } },
            },
          },
          { $sort: { hits: -1, entries: -1 } },
        ])
        .exec(),
    ]);

    const summary = totals[0] ?? { entries: 0, hits: 0 };

    return {
      mongoEntries: summary.entries,
      mongoHitsTotal: summary.hits,
      byEngine: byEngine.map((row) => ({
        key: String(row._id ?? 'unknown'),
        entries: row.entries,
        hits: row.hits,
      })),
      byKind: byKind.map((row) => ({
        key: String(row._id ?? 'unknown'),
        entries: row.entries,
        hits: row.hits,
      })),
    };
  }
}
