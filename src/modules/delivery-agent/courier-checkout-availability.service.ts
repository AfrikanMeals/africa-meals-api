import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  agentHasDeliveryCapacity,
  type AgentApplicationCapacitySource,
} from '@modules/delivery-agent/delivery-agent-capacity.util';
import {
  decideCheckoutCourierAvailability,
  type CheckoutCourierAvailabilityRow,
  type CheckoutCourierAvailabilityState,
} from '@modules/delivery-agent/checkout-courier-availability.decision';
import { CourierGeoService } from '@modules/fleet/courier-geo.service';
import {
  COURIER_GEO_DEFAULT_RADIUS_KM,
  COURIER_GEO_META_TTL_SEC,
} from '@modules/fleet/courier-geo.constants';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import { StoreDeliveryDriversService } from '@modules/store-delivery-drivers/store-delivery-drivers.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { Model, Types } from 'mongoose';

export type {
  CheckoutCourierAvailabilityRow,
  CheckoutCourierAvailabilityState,
} from '@modules/delivery-agent/checkout-courier-availability.decision';

type CandidateApplication = AgentApplicationCapacitySource & {
  user?: unknown;
  region?: string | null;
};

/**
 * Vérifie si chaque boutique dispose d’au moins un livreur assignable maintenant.
 * Le contrôle est batché, borné et réutilise Redis GEO avant un fallback Mongo frais.
 */
@Injectable()
export class CourierCheckoutAvailabilityService {
  private readonly logger = new Logger(CourierCheckoutAvailabilityService.name);

  constructor(
    @InjectModel(OrderModel.name) private readonly orders: Model<OrderModel>,
    @InjectModel(StoreModel.name) private readonly stores: Model<StoreModel>,
    @InjectModel(DeliveryAgentApplicationModel.name)
    private readonly applications: Model<DeliveryAgentApplicationModel>,
    private readonly courierGeo: CourierGeoService,
    private readonly storeDrivers: StoreDeliveryDriversService,
    private readonly platformShipping: PlatformShippingSettingsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Déduplique les ids et lance les boutiques en parallèle ; le DTO limite déjà à 20.
   */
  async checkStores(
    storeIds: string[],
  ): Promise<{ items: CheckoutCourierAvailabilityRow[] }> {
    const uniqueIds = [
      ...new Set(storeIds.map((id) => String(id).trim()).filter(Boolean)),
    ];
    const items = await Promise.all(
      uniqueIds.map((storeId) => this.checkStoreSafely(storeId)),
    );
    return { items };
  }

  /**
   * Une erreur d’infrastructure reste `unknown` : le mobile conserve alors le
   * comportement historique au lieu de masquer Livraison par faux négatif.
   */
  private async checkStoreSafely(
    storeId: string,
  ): Promise<CheckoutCourierAvailabilityRow> {
    try {
      return await this.checkStore(storeId);
    } catch (error) {
      this.logger.warn(
        `checkout courier availability store=${storeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        storeId,
        state: 'unknown',
        strategy: 'platform',
        reason: 'availability_check_failed',
      };
    }
  }

  /**
   * Flotte assignable → self-shipping → flotte vide → pool plateforme (décision pure).
   */
  private async checkStore(
    storeId: string,
  ): Promise<CheckoutCourierAvailabilityRow> {
    if (!Types.ObjectId.isValid(storeId)) {
      return {
        storeId,
        state: 'unavailable',
        strategy: 'platform',
        reason: 'invalid_store',
      };
    }
    const store = await this.stores
      .findById(new Types.ObjectId(storeId))
      .select(
        'supportsShipping vendorManagesDeliveryDrivers deliveryAssignmentMode address region',
      )
      .populate('address', 'location')
      .lean()
      .exec();
    const managed = this.storeDrivers.isStoreManagedDelivery(store);
    const assignmentMode = this.storeDrivers.storeAssignmentMode(store);
    const supportsShipping = !!store && store.supportsShipping === true;
    const region = String((store as { region?: string } | null)?.region ?? '')
      .trim()
      .toUpperCase();
    const policy = await this.subscriptions.resolveStoreDeliveryPolicy(storeId);

    // Flotte : seulement si gérée (évite requêtes inutiles en mode plateforme).
    let fleetHasAssignable = false;
    if (managed && supportsShipping) {
      const fleetIds = await this.storeDrivers.listActiveDriverUserIdsForStore(
        storeId,
      );
      fleetHasAssignable = await this.hasAssignableCandidate(fleetIds, region);
    }

    // Self-shipping / flotte gérée : pas besoin du pool plateforme (vendeur peut s’assigner).
    const needsPlatform =
      supportsShipping &&
      !fleetHasAssignable &&
      !policy.selfDeliveryRequired &&
      !managed;

    let platformHasAssignable: boolean | null = false;
    if (needsPlatform) {
      const platformIds = await this.platformCandidateIds(
        (store ?? {}) as Record<string, unknown>,
        region,
      );
      if (platformIds == null) {
        platformHasAssignable = null;
      } else if (platformIds.length === 0) {
        platformHasAssignable = false;
      } else {
        platformHasAssignable = await this.hasAssignableCandidate(
          platformIds,
          region,
        );
      }
    }

    return decideCheckoutCourierAvailability({
      storeId,
      supportsShipping,
      managed,
      selfDeliveryRequired: policy.selfDeliveryRequired === true,
      assignmentMode,
      fleetHasAssignable,
      platformHasAssignable,
    });
  }

  /**
   * Vérifie présence APPROVED + région + capacité et s’arrête au premier match.
   * Cette branche évite le ranking/performance/VROOM, inutiles pour un booléen.
   */
  private async hasAssignableCandidate(
    candidateIds: string[],
    region: string,
  ): Promise<boolean> {
    if (candidateIds.length === 0) return false;
    const apps = await this.applications
      .find({
        user: {
          $in: candidateIds
            .filter((id) => Types.ObjectId.isValid(id))
            .map((id) => new Types.ObjectId(id)),
        },
        status: DeliveryAgentApplicationStatus.APPROVED,
        dashboardAvailability: { $ne: 'hors_ligne' },
      })
      .select('user region vehicle maxConcurrentOrders dashboardAvailability')
      .lean()
      .exec();
    const byUser = new Map(
      apps.map((app) => [
        String((app as { user?: unknown }).user ?? ''),
        app as CandidateApplication,
      ]),
    );

    // Court-circuit : dans le cas nominal, une seule agrégation capacité suffit.
    for (const candidateId of candidateIds) {
      const app = byUser.get(candidateId);
      if (!app) continue;
      const agentRegion = String(app.region ?? '')
        .trim()
        .toUpperCase();
      if (region && agentRegion && region !== agentRegion) continue;
      const capacity = await agentHasDeliveryCapacity(
        this.orders,
        app,
        new Types.ObjectId(candidateId),
      );
      if (capacity.allowed) return true;
    }
    return false;
  }

  /**
   * Retourne les livreurs live proches de la boutique. `null` signifie que la
   * géolocalisation boutique manque ; une liste vide est un vrai « aucun livreur ».
   */
  private async platformCandidateIds(
    store: Record<string, unknown>,
    region: string,
  ): Promise<string[] | null> {
    const storeLngLat = this.storeLngLat(store);
    if (!storeLngLat) return null;
    const settings = await this.platformShipping.getPublicSettings(
      region || undefined,
    );
    const radiusKm = Math.max(
      1,
      Math.min(
        80,
        Number(settings.maxDeliveryRadiusKm) || COURIER_GEO_DEFAULT_RADIUS_KM,
      ),
    );
    const live = await this.courierGeo.searchNearby({
      longitude: storeLngLat[0],
      latitude: storeLngLat[1],
      radiusKm,
      limit: 20,
    });
    if (live.length > 0) return live.map((row) => row.agentUserId);

    // Redis indisponible/vide : seules les positions Mongo encore fraîches comptent.
    const freshSince = new Date(Date.now() - COURIER_GEO_META_TTL_SEC * 1000);
    const fallback = await this.applications
      .find({
        status: DeliveryAgentApplicationStatus.APPROVED,
        dashboardAvailability: { $ne: 'hors_ligne' },
        ...(region ? { region } : {}),
        lastLatitude: { $type: 'number' },
        lastLongitude: { $type: 'number' },
        locationUpdatedAt: { $gte: freshSince },
      })
      .select('user lastLatitude lastLongitude')
      .limit(100)
      .lean()
      .exec();
    const maxDistanceMeters = radiusKm * 1000;
    return fallback
      .map((app) => {
        const latitude = Number(
          (app as { lastLatitude?: number }).lastLatitude,
        );
        const longitude = Number(
          (app as { lastLongitude?: number }).lastLongitude,
        );
        const distanceMeters = this.haversineMeters(
          storeLngLat[1],
          storeLngLat[0],
          latitude,
          longitude,
        );
        return {
          userId: String((app as { user?: unknown }).user ?? ''),
          distanceMeters,
        };
      })
      .filter(
        (row) =>
          Types.ObjectId.isValid(row.userId) &&
          Number.isFinite(row.distanceMeters) &&
          row.distanceMeters <= maxDistanceMeters,
      )
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .map((row) => row.userId);
  }

  /** Lit les coordonnées GeoJSON `[longitude, latitude]` de la boutique. */
  private storeLngLat(store: Record<string, unknown>): [number, number] | null {
    const address = store.address;
    if (!address || typeof address !== 'object') return null;
    const coordinates = (address as { location?: { coordinates?: unknown[] } })
      .location?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return [longitude, latitude];
  }

  /** Distance sphérique suffisante pour le fallback rare sans charger le routeur. */
  private haversineMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.NaN;
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);
    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(deltaLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
