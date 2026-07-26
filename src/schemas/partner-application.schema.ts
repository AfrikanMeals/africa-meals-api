import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

/** Cycle candidature partenaire plateforme (aligné livreur). */
export enum PartnerApplicationStatus {
  DRAFT = 'DRAFT',
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  /** Compte partenaire désactivé ; type utilisateur restauré depuis previousUserType. */
  SUSPENDED = 'SUSPENDED',
}

@Schema({
  timestamps: true,
  collection: 'partner_applications',
  toJSON: { virtuals: true, getters: true },
})
export class PartnerApplicationModel extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    unique: true,
    index: true,
  })
  user: MongooseSchema.Types.ObjectId;

  @Prop({
    enum: PartnerApplicationStatus,
    default: PartnerApplicationStatus.DRAFT,
  })
  status: PartnerApplicationStatus;

  /** Avancement wizard mobile (0 = intro, 1 = infos, 2 = CGU). */
  @Prop({ default: 0, min: 0, max: 3 })
  onboardingStep: number;

  /** Raison sociale / nom d’organisation (optionnel). */
  @Prop({ required: false, maxlength: 120, name: 'organization_name' })
  organizationName?: string;

  /** Pays ISO d’exercice. */
  @Prop({ required: false, maxlength: 2, uppercase: true, trim: true })
  region?: string;

  /** Motivation / description de la collaboration souhaitée. */
  @Prop({ required: false, maxlength: 1000, name: 'collaboration_notes' })
  collaborationNotes?: string;

  @Prop({ default: false, name: 'terms_accepted' })
  termsAccepted: boolean;

  @Prop({ required: false, name: 'submitted_at' })
  submittedAt?: Date;

  @Prop({ required: false, maxlength: 500, name: 'rejection_reason' })
  rejectionReason?: string;

  /**
   * Code de parrainage 6 caractères — attribué à l’approbation admin.
   * Unique sparse : absents tant que DRAFT / AWAITING_REVIEW / REJECTED.
   */
  @Prop({
    required: false,
    maxlength: 6,
    uppercase: true,
    trim: true,
    unique: true,
    sparse: true,
    name: 'referral_code',
  })
  referralCode?: string;

  /**
   * Type compte avant approve (USER / VENDOR / DELIVERY).
   * Restauré à la suspension pour ne pas forcer USER sur un ex-VENDOR.
   */
  @Prop({ required: false, maxlength: 32, name: 'previous_user_type' })
  previousUserType?: string;
}

export const PartnerApplicationSchema = SchemaFactory.createForClass(
  PartnerApplicationModel,
);

export type PartnerApplicationDocument = PartnerApplicationModel & Document;
