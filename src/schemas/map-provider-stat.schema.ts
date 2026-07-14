import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Stats provider map (L2 Mongo) — hits Redis, appels externes, latences.
 * Agrégat journalier par engine / kind.
 */
@Schema({ timestamps: true, collection: 'map_provider_stats' })
export class MapProviderStatModel {
  @Prop({ type: String, required: true, index: true })
  dayKey: string;

  @Prop({ type: String, required: true, index: true })
  engine: string;

  @Prop({
    type: String,
    required: true,
    enum: ['matrix', 'route', 'eta', 'traffic', 'geocode', 'distance'],
    index: true,
  })
  kind: string;

  @Prop({ type: Number, default: 0 })
  cacheHits: number;

  @Prop({ type: Number, default: 0 })
  cacheMisses: number;

  @Prop({ type: Number, default: 0 })
  externalCalls: number;

  @Prop({ type: Number, default: 0 })
  externalErrors: number;

  @Prop({ type: Number, default: 0 })
  totalLatencyMs: number;
}

export type MapProviderStatDocument = HydratedDocument<MapProviderStatModel>;

export const MapProviderStatSchema =
  SchemaFactory.createForClass(MapProviderStatModel);

MapProviderStatSchema.index({ dayKey: 1, engine: 1, kind: 1 }, { unique: true });
