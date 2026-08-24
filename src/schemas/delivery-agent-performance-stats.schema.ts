import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import type { UserModel } from './user.schema';

/**
 * Compteurs de performance livreur (lifetime) — acceptance, refus, durée, distance.
 * Alimente le ranking marketplace / flotte et l’écran perf mobile.
 */
@Schema({
  timestamps: true,
  collection: 'delivery_agent_performance_stats',
})
export class DeliveryAgentPerformanceStatsModel extends BaseSchema {
  @Prop({
    required: true,
    unique: true,
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
    index: true,
  })
  deliveryAgent: UserModel;

  /** Offres exclusives flotte présentées. */
  @Prop({ required: true, min: 0, default: 0 })
  offersPresented: number;

  @Prop({ required: true, min: 0, default: 0 })
  offersAccepted: number;

  @Prop({ required: true, min: 0, default: 0 })
  offersRejected: number;

  @Prop({ required: true, min: 0, default: 0 })
  offersExpired: number;

  /** Notifs marketplace (file ouverte) reçues. */
  @Prop({ required: true, min: 0, default: 0 })
  marketplaceNotified: number;

  /** Claims réussis (marketplace ou self-assign hors offre). */
  @Prop({ required: true, min: 0, default: 0 })
  marketplaceClaims: number;

  /** Courses perdues (autre livreur a claim) après notif. */
  @Prop({ required: true, min: 0, default: 0 })
  marketplaceMissed: number;

  /** Abandons livreur (`courier_abandon`). */
  @Prop({ required: true, min: 0, default: 0 })
  unassignByCourier: number;

  /** Abandons après `storeCollectedAt` (sous-ensemble ; score + pénalités). */
  @Prop({ required: true, min: 0, default: 0 })
  unassignAfterStoreCollect: number;

  /** Retraits admin / vendeur. */
  @Prop({ required: true, min: 0, default: 0 })
  unassignByOther: number;

  /** Livraisons terminées (COMPLETED). */
  @Prop({ required: true, min: 0, default: 0 })
  completedDeliveries: number;

  /** Somme des durées claim → completed (secondes). */
  @Prop({ required: true, min: 0, default: 0 })
  totalDeliveryDurationSec: number;

  /** Somme des distances course (km, store→client ou tracked). */
  @Prop({ required: true, min: 0, default: 0 })
  totalDistanceKm: number;
}

export const DeliveryAgentPerformanceStatsSchema = SchemaFactory.createForClass(
  DeliveryAgentPerformanceStatsModel,
);

export type DeliveryAgentPerformanceStatsDocument =
  DeliveryAgentPerformanceStatsModel & Document;
