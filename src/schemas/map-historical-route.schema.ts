import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Routes / matrices historiques (L2 Mongo) — résumé OD pour analytics.
 * Le compute reste OSRM ; Redis garde le hot path.
 */
@Schema({ timestamps: true, collection: 'map_historical_routes' })
export class MapHistoricalRouteModel {
  @Prop({ type: String, required: true, unique: true, index: true })
  fingerprint: string;

  @Prop({ type: String, required: true, index: true })
  engine: string;

  @Prop({
    type: String,
    required: true,
    enum: ['matrix', 'route', 'distance'],
    index: true,
  })
  kind: string;

  @Prop({ type: Number, required: true })
  pointCount: number;

  /** Durée moyenne / première OD (s) si disponible. */
  @Prop({ type: Number, default: null })
  durationSeconds: number | null;

  @Prop({ type: Number, default: null })
  distanceMeters: number | null;

  @Prop({ type: Number, default: 1 })
  useCount: number;

  @Prop({ type: Date, default: null })
  lastUsedAt: Date | null;
}

export type MapHistoricalRouteDocument =
  HydratedDocument<MapHistoricalRouteModel>;

export const MapHistoricalRouteSchema = SchemaFactory.createForClass(
  MapHistoricalRouteModel,
);

MapHistoricalRouteSchema.index({ engine: 1, updatedAt: -1 });
MapHistoricalRouteSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
