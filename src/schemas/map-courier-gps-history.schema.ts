import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * GPS history livreur (L2 Mongo) — échantillons throttlés (pas 2 s).
 * Live = Redis GEO. Dernière pos = delivery_agent_applications.
 */
@Schema({ timestamps: true, collection: 'map_courier_gps_history' })
export class MapCourierGpsHistoryModel {
  @Prop({ type: String, required: true, index: true })
  agentUserId: string;

  @Prop({ type: Number, required: true })
  latitude: number;

  @Prop({ type: Number, required: true })
  longitude: number;

  @Prop({ type: Number, default: null })
  speedMps: number | null;

  @Prop({ type: Number, default: null })
  headingDegrees: number | null;

  @Prop({ type: String, default: null })
  region: string | null;

  @Prop({ type: Date, required: true, index: true })
  recordedAt: Date;
}

export type MapCourierGpsHistoryDocument =
  HydratedDocument<MapCourierGpsHistoryModel>;

export const MapCourierGpsHistorySchema = SchemaFactory.createForClass(
  MapCourierGpsHistoryModel,
);

MapCourierGpsHistorySchema.index({ agentUserId: 1, recordedAt: -1 });
MapCourierGpsHistorySchema.index(
  { recordedAt: 1 },
  { expireAfterSeconds: 14 * 24 * 60 * 60 },
);
