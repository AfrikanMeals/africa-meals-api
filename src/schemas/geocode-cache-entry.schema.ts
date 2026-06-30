import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Entrée cache géocodage persistant (OSM stockable ; Mapbox si tier Permanent). */
@Schema({ timestamps: true, collection: 'geocode_cache_entries' })
export class GeocodeCacheEntryModel {
  @Prop({ type: String, required: true, unique: true, index: true })
  cacheKey: string;

  @Prop({
    type: String,
    required: true,
    enum: ['forward', 'reverse', 'structured'],
    index: true,
  })
  kind: 'forward' | 'reverse' | 'structured';

  @Prop({ type: String, required: true, index: true })
  normalizedQuery: string;

  @Prop({ type: String, required: true, index: true })
  countryCode: string;

  @Prop({ type: String, required: true })
  engine: string;

  @Prop({ type: Object, required: true })
  payload: Record<string, unknown>;

  @Prop({ type: Number, default: 0 })
  hitCount: number;

  @Prop({ type: Date, default: null })
  lastHitAt: Date | null;
}

export type GeocodeCacheEntryDocument =
  HydratedDocument<GeocodeCacheEntryModel>;

export const GeocodeCacheEntrySchema = SchemaFactory.createForClass(
  GeocodeCacheEntryModel,
);

GeocodeCacheEntrySchema.index({ countryCode: 1, updatedAt: -1 });
