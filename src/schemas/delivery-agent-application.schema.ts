import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

export enum DeliveryAgentApplicationStatus {
  DRAFT = 'DRAFT',
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  /** Compte livreur désactivé par l’admin (type utilisateur repassé en USER). */
  SUSPENDED = 'SUSPENDED',
}

export type DeliveryAgentVehicle = 'moto' | 'velo' | 'voiture';

@Schema({
  timestamps: true,
  collection: 'delivery_agent_applications',
  toJSON: { virtuals: true, getters: true },
})
export class DeliveryAgentApplicationModel extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    unique: true,
    index: true,
  })
  user: MongooseSchema.Types.ObjectId;

  @Prop({
    enum: DeliveryAgentApplicationStatus,
    default: DeliveryAgentApplicationStatus.DRAFT,
  })
  status: DeliveryAgentApplicationStatus;

  /** Avancement local (0 = démarré, 1 = véhicule + zone, 2 = prêt à soumettre). */
  @Prop({ default: 0, min: 0, max: 4 })
  onboardingStep: number;

  @Prop({ required: false })
  vehicle?: DeliveryAgentVehicle;

  /** Plaque ou identifiant véhicule (optionnel pour vélo). */
  @Prop({ required: false, maxlength: 32, name: 'vehicle_registration' })
  vehicleRegistration?: string;

  /** Numéro de permis de conduire (obligatoire moto / voiture). */
  @Prop({ required: false, maxlength: 32, name: 'driver_license' })
  driverLicense?: string;

  /** Nombre max de commandes simultanées (défaut selon [vehicle] si absent). */
  @Prop({ required: false, min: 1, max: 6, name: 'max_concurrent_orders' })
  maxConcurrentOrders?: number;

  @Prop({ required: false, maxlength: 500 })
  serviceZone?: string;

  @Prop({ default: false, name: 'terms_accepted' })
  termsAccepted: boolean;

  @Prop({ required: false, name: 'submitted_at' })
  submittedAt?: Date;

  @Prop({ required: false, maxlength: 500, name: 'rejection_reason' })
  rejectionReason?: string;

  /** Dernière position GPS reportée par l’app livreur (suivi temps réel). */
  @Prop({ required: false, min: -90, max: 90 })
  lastLatitude?: number;

  @Prop({ required: false, min: -180, max: 180 })
  lastLongitude?: number;

  @Prop({ required: false })
  locationUpdatedAt?: Date;
}

export const DeliveryAgentApplicationSchema = SchemaFactory.createForClass(
  DeliveryAgentApplicationModel,
);

export type DeliveryAgentApplicationDocument =
  DeliveryAgentApplicationModel & Document;
