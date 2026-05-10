import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

export enum DeliveryAgentApplicationStatus {
  DRAFT = 'DRAFT',
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
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
  @Prop({ default: 0, min: 0, max: 3 })
  onboardingStep: number;

  @Prop({ required: false })
  vehicle?: DeliveryAgentVehicle;

  @Prop({ required: false, maxlength: 500 })
  serviceZone?: string;

  @Prop({ default: false, name: 'terms_accepted' })
  termsAccepted: boolean;

  @Prop({ required: false, name: 'submitted_at' })
  submittedAt?: Date;

  @Prop({ required: false, maxlength: 500, name: 'rejection_reason' })
  rejectionReason?: string;
}

export const DeliveryAgentApplicationSchema = SchemaFactory.createForClass(
  DeliveryAgentApplicationModel,
);

export type DeliveryAgentApplicationDocument =
  DeliveryAgentApplicationModel & Document;
