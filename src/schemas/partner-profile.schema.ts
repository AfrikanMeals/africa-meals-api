import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

/** Type de compte fiche partenaire (Individu vs Société). */
export enum PartnerAccountType {
  INDIVIDUAL = 'INDIVIDUAL',
  COMPANY = 'COMPANY',
}

/** Cycle fiche partenaire (brouillon → revue admin). */
export enum PartnerProfileStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

@Schema({
  timestamps: true,
  collection: 'partner_profiles',
  toJSON: { virtuals: true, getters: true },
})
export class PartnerProfileModel extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    unique: true,
    index: true,
  })
  user: MongooseSchema.Types.ObjectId;

  @Prop({
    enum: PartnerProfileStatus,
    default: PartnerProfileStatus.DRAFT,
  })
  status: PartnerProfileStatus;

  /** Avancement wizard : 0 identité · 1 réseaux · 2 politique. */
  @Prop({ default: 0, min: 0, max: 2 })
  onboardingStep: number;

  @Prop({
    enum: PartnerAccountType,
    required: false,
    name: 'account_type',
  })
  accountType?: PartnerAccountType;

  /** Nom (personne physique). */
  @Prop({ required: false, maxlength: 120, name: 'individual_name' })
  individualName?: string;

  /** Raison sociale (personne morale). */
  @Prop({ required: false, maxlength: 120, name: 'company_name' })
  companyName?: string;

  /** N° fiscal / TVA — optionnel. */
  @Prop({ required: false, maxlength: 64, name: 'tax_number' })
  taxNumber?: string;

  /** Adresse postale / siège (texte libre / reverse geocode). */
  @Prop({ required: false, maxlength: 500 })
  address?: string;

  /** Coordonnées carte (optionnelles, pour aperçu mobile). */
  @Prop({ required: false, name: 'address_latitude' })
  addressLatitude?: number;

  @Prop({ required: false, name: 'address_longitude' })
  addressLongitude?: number;

  @Prop({ required: false, maxlength: 500, name: 'facebook_url' })
  facebookUrl?: string;

  @Prop({ required: false, maxlength: 500, name: 'tiktok_url' })
  tiktokUrl?: string;

  @Prop({ required: false, maxlength: 500, name: 'instagram_url' })
  instagramUrl?: string;

  /** Acceptation Partner & Affiliation Policy. */
  @Prop({ default: false, name: 'policy_accepted' })
  policyAccepted: boolean;

  @Prop({ required: false, name: 'submitted_at' })
  submittedAt?: Date;

  /** Motif refus / suspension admin. */
  @Prop({ required: false, maxlength: 1000, name: 'rejection_reason' })
  rejectionReason?: string;

  /**
   * Type utilisateur avant suspension fiche (restauration à la réactivation).
   * Les comptes nés PARTNER (signup) replient sur USER.
   */
  @Prop({ required: false, name: 'previous_user_type' })
  previousUserType?: string;

  @Prop({ required: false, name: 'reviewed_at' })
  reviewedAt?: Date;
}

export const PartnerProfileSchema =
  SchemaFactory.createForClass(PartnerProfileModel);

export type PartnerProfileDocument = PartnerProfileModel & Document;
