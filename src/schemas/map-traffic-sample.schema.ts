import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Échantillons trafic historiques (L2 Mongo) — throttlés, pas 1 écriture / GPS tick.
 * Redis flotte + Neo4j TrafficCell restent L1 / graphe.
 */
@Schema({ timestamps: true, collection: 'map_traffic_samples' })
export class MapTrafficSampleModel {
  @Prop({ type: String, required: true, index: true })
  cellId: string;

  @Prop({ type: Number, required: true })
  latitude: number;

  @Prop({ type: Number, required: true })
  longitude: number;

  @Prop({ type: Number, required: true })
  speedKmh: number;

  @Prop({ type: Number, default: null })
  headingDegrees: number | null;

  @Prop({ type: Number, default: null })
  factor: number | null;

  @Prop({ type: String, default: 'fleet' })
  source: string;

  @Prop({ type: Date, required: true, index: true })
  sampledAt: Date;
}

export type MapTrafficSampleDocument =
  HydratedDocument<MapTrafficSampleModel>;

export const MapTrafficSampleSchema = SchemaFactory.createForClass(
  MapTrafficSampleModel,
);

MapTrafficSampleSchema.index({ cellId: 1, sampledAt: -1 });
/** TTL ~30 jours. */
MapTrafficSampleSchema.index(
  { sampledAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
