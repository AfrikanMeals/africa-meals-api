import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Disponibilité des moteurs carte (admin vendeur + app mobile). */
@Schema({ timestamps: true, collection: 'map_settings' })
export class MapSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Tableau de bord admin — comptes vendeur. */
  @Prop({ type: Boolean, default: true })
  vendorMapboxEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  vendorGoogleEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  vendorOsmEnabled: boolean;

  /** Moteur par défaut — tableau de bord vendeur (mapbox | google | osm). */
  @Prop({ type: String, default: 'osm', trim: true })
  vendorDefaultMapEngine: string;

  /** App mobile — mode client (USER). */
  @Prop({ type: Boolean, default: true })
  mobileUserMapboxEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileUserGoogleEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileUserOsmEnabled: boolean;

  /** Moteur par défaut — app mobile client (mapbox | google | osm). */
  @Prop({ type: String, default: 'osm', trim: true })
  mobileUserDefaultMapEngine: string;

  /** App mobile — mode livreur (DELIVERY). */
  @Prop({ type: Boolean, default: true })
  mobileDeliveryMapboxEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileDeliveryGoogleEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileDeliveryOsmEnabled: boolean;

  /** Moteur par défaut — app mobile livreur (mapbox | google | osm). */
  @Prop({ type: String, default: 'osm', trim: true })
  mobileDeliveryDefaultMapEngine: string;

  /** API géocodage — vendeur web (+ mobile vendeur). */
  @Prop({ type: String, default: 'osm', trim: true })
  vendorGeocodingEngine: string;

  /** API géocodage — client mobile. */
  @Prop({ type: String, default: 'osm', trim: true })
  mobileUserGeocodingEngine: string;

  /** API géocodage — livreur mobile. */
  @Prop({ type: String, default: 'osm', trim: true })
  mobileDeliveryGeocodingEngine: string;

  /** Pool géocodage pondéré — vendeur (engine + weight). */
  @Prop({ type: [{ engine: String, weight: Number }], default: [] })
  vendorGeocodingEnginePool: { engine: string; weight: number }[];

  /** Pool géocodage pondéré — client mobile. */
  @Prop({ type: [{ engine: String, weight: Number }], default: [] })
  mobileUserGeocodingEnginePool: { engine: string; weight: number }[];

  /** Pool géocodage pondéré — livreur mobile. */
  @Prop({ type: [{ engine: String, weight: Number }], default: [] })
  mobileDeliveryGeocodingEnginePool: { engine: string; weight: number }[];

  /** API itinéraires / ETA — vendeur (fallback si formule sans pool). */
  @Prop({ type: String, default: 'osrm', trim: true })
  vendorRoutingEngine: string;

  /** API itinéraires / ETA — client mobile. */
  @Prop({ type: String, default: 'osrm', trim: true })
  mobileUserRoutingEngine: string;

  /** API itinéraires / ETA — livreur mobile. */
  @Prop({ type: String, default: 'osrm', trim: true })
  mobileDeliveryRoutingEngine: string;

  /** Pool itinéraires pondéré — vendeur. */
  @Prop({ type: [{ engine: String, weight: Number }], default: [] })
  vendorRoutingEnginePool: { engine: string; weight: number }[];

  /** Pool itinéraires pondéré — client mobile. */
  @Prop({ type: [{ engine: String, weight: Number }], default: [] })
  mobileUserRoutingEnginePool: { engine: string; weight: number }[];

  /** Pool itinéraires pondéré — livreur mobile. */
  @Prop({ type: [{ engine: String, weight: Number }], default: [] })
  mobileDeliveryRoutingEnginePool: { engine: string; weight: number }[];

  /** Priorité des backends cache géocodage (redis | memcached | mongodb). */
  @Prop({
    type: [String],
    default: ['redis', 'memcached', 'mongodb'],
  })
  geocodeCacheStorePriority: string[];

  /**
   * Cache / perf itinéraires (TTL, invalidation GPS, alternatives).
   * GPS marqueur reste précis ; re-routing Directions seulement si déplacement significatif.
   */
  @Prop({
    type: Object,
    default: {
      staticTtlSeconds: 900,
      dynamicTtlSeconds: 45,
      agentMoveInvalidateMeters: 100,
      requestAlternatives: false,
      adminTtlMs: 120000,
      gpsMarkerDistanceFilterMeters: 5,
      routeRefreshDebounceMs: 1200,
    },
  })
  routingCache: {
    staticTtlSeconds: number;
    dynamicTtlSeconds: number;
    agentMoveInvalidateMeters: number;
    requestAlternatives: boolean;
    adminTtlMs: number;
    gpsMarkerDistanceFilterMeters: number;
    routeRefreshDebounceMs: number;
  };

  /** Overrides moteurs carte / géocodage par région active (ISO2). */
  @Prop({ type: Object, default: {} })
  settingsByRegion: Record<string, Record<string, unknown>>;
}

export type MapSettingsDocument = HydratedDocument<MapSettingsModel>;

export const MapSettingsSchema =
  SchemaFactory.createForClass(MapSettingsModel);
