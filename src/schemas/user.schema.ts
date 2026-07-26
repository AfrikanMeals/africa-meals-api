import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PartnerBadgeCode } from '@common/partner-badges/partner-badge.constants';
import { hashPassword } from '@common/crypto/password-hash.util';
import { Type } from 'class-transformer';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { AddressModel } from './address.schema';
import { BaseSchema } from './base.schema';
import { PaymentMethodModel } from './payment-method.schema';
import type { StoreModel } from './store.schema';
import { PlatformRoleModel } from './platform-role.schema';

export enum UserTypeEnum {
  /** Client final (inscription « Client ») */
  USER = 'USER',
  /** Restaurant / vendeur (inscription « Restaurant / Vendeur ») */
  VENDOR = 'VENDOR',
  /** Livreur (inscription « Livreur ») */
  DELIVERY = 'DELIVERY',
  /** Partenaire plateforme (inscription « Partenaire » / partner.*) */
  PARTNER = 'PARTNER',
  ADMIN = 'ADMIN',
}

@Schema({
  timestamps: true,
  collection: 'users',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class UserModel extends BaseSchema {
  @Prop({ enum: UserTypeEnum, default: UserTypeEnum.USER })
  type: UserTypeEnum;

  /** @deprecated Utiliser `platformRoleIds`. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: PlatformRoleModel.name,
    required: false,
    name: 'platform_role_id',
  })
  platformRoleId?: Types.ObjectId;

  /** Rôles plateforme (utilisateurs ADMIN) — permissions = union des rôles. */
  @Prop({
    type: [
      { type: MongooseSchema.Types.ObjectId, ref: PlatformRoleModel.name },
    ],
    default: [],
    name: 'platform_role_ids',
  })
  platformRoleIds?: Types.ObjectId[];

  @Prop({ required: true, name: 'full_name' })
  fullName: string;

  @Prop({ required: true, name: 'email', unique: true })
  email: string;

  /**
   * Identifiant public manquant optionnel (PATCH /auth/me).
   * Sparse unique : plusieurs users sans username OK ; doublons interdits.
   * Toujours stocké en minuscules (voir normalizeUsername).
   */
  @Prop({
    required: false,
    name: 'username',
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
  })
  username?: string;

  @Prop({ required: false, name: 'phone_number' })
  phoneNumber?: string;

  /**
   * Date de naissance (optionnelle) — contrôle parental / âge.
   * Jamais obligatoire à l’inscription ; PATCH /auth/me peut l’effacer.
   */
  @Prop({ required: false, type: Date, name: 'date_of_birth' })
  dateOfBirth?: Date;

  /** Pays d’utilisation de l’app (ISO2), ex. CA, SN */
  @Prop({ required: false, default: 'CA', name: 'app_country_code' })
  appCountryCode?: string;

  @Prop({ required: false, name: 'profile_image' })
  profileImage?: string;

  @Prop({
    required: false,
    default: null,
    type: 'date',
    name: 'email_verified_at',
  })
  emailVerifiedAt?: Date;

  /** Sparse : plusieurs docs sans facebook_id restent possibles. */
  @Prop({ required: false, name: 'facebook_id', index: true, sparse: true })
  facebookId?: string;

  @Prop({ required: false, name: 'google_id', index: true, sparse: true })
  googleId?: string;

  @Prop({ required: false, name: 'apple_id', index: true, sparse: true })
  appleId?: string;

  @Prop({
    required: false,
    name: 'address',
    type: [MongooseSchema.Types.ObjectId],
    ref: AddressModel.name,
    default: [],
  })
  @Type(() => Array<AddressModel>)
  addresses?: AddressModel[];

  @Prop({
    required: false,
    name: 'stores',
    type: [MongooseSchema.Types.ObjectId],
    ref: 'StoreModel',
    default: [],
  })
  stores?: StoreModel[];

  @Prop({
    required: false,
    name: 'payment_methods',
    type: [MongooseSchema.Types.ObjectId],
    ref: 'PaymentMethodModel',
    default: [],
  })
  @Type(() => Array<PaymentMethodModel>)
  paymentMethods?: PaymentMethodModel[];

  /** Accès au programme fidélité / récompenses (activation manuelle admin). */
  @Prop({ default: false, name: 'reward_program_eligible' })
  rewardProgramEligible?: boolean;

  /** Mode debug activé par un admin (diagnostics côté client). */
  @Prop({ default: false, name: 'debug' })
  debug?: boolean;

  /** Accès à la messagerie (client / vendeur / livreur). Désactivé = bannissement avec motif. */
  @Prop({ default: true, name: 'can_messaging' })
  canMessaging?: boolean;

  @Prop({ required: false, maxlength: 500, name: 'messaging_ban_reason' })
  messagingBanReason?: string;

  /** Points fidélité cumulés */
  @Prop({ default: 0, name: 'loyalty_points' })
  loyaltyPoints?: number;

  /** Historique des gains / débits de points */
  @Prop({
    type: [
      {
        points: { type: Number, required: true },
        reason: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
    name: 'reward_history',
  })
  rewardHistory?: { points: number; reason: string; createdAt: Date }[];

  @Prop({ required: true, name: 'password', select: false })
  password: string;

  @Prop({ required: false, name: 'activation_code', select: false })
  activationCode?: string;

  @Prop({ required: false, name: 'activation_code_expires_at', select: false })
  activationCodeExpiresAt?: Date;

  @Prop({ required: false, name: 'password_reset_code', select: false })
  passwordResetCode?: string;

  @Prop({
    required: false,
    name: 'password_reset_code_expires_at',
    select: false,
  })
  passwordResetCodeExpiresAt?: Date;

  /** Double authentification par code e-mail à la connexion. */
  @Prop({ default: false, name: 'email_2fa_enabled' })
  email2faEnabled?: boolean;

  /** Code en attente pour confirmer l’activation 2FA e-mail. */
  @Prop({ required: false, name: 'email_2fa_enable_code', select: false })
  email2faEnableCode?: string;

  @Prop({
    required: false,
    name: 'email_2fa_enable_code_expires_at',
    select: false,
  })
  email2faEnableCodeExpiresAt?: Date;

  /** Code à la connexion lorsque la 2FA e-mail est active. */
  @Prop({ required: false, name: 'email_2fa_login_code', select: false })
  email2faLoginCode?: string;

  @Prop({
    required: false,
    name: 'email_2fa_login_code_expires_at',
    select: false,
  })
  email2faLoginCodeExpiresAt?: Date;

  /** Demande de suppression de compte (soft delete), exécution différée. */
  @Prop({
    required: false,
    default: null,
    type: 'date',
    name: 'account_deletion_requested_at',
  })
  accountDeletionRequestedAt?: Date | null;

  /** Date prévue de suppression définitive (cron). */
  @Prop({
    required: false,
    default: null,
    type: 'date',
    name: 'account_deletion_scheduled_for',
  })
  accountDeletionScheduledFor?: Date | null;

  /** Compte désactivé par un admin — connexion et JWT refusés. */
  @Prop({
    required: false,
    default: null,
    type: 'date',
    name: 'account_disabled_at',
  })
  accountDisabledAt?: Date | null;

  /**
   * Jetons FCM (mobile / web) pour les notifications push — plusieurs appareils par utilisateur.
   */
  @Prop({
    type: [
      {
        token: { type: String, required: true },
        platform: { type: String, required: true },
        updatedAt: { type: Date, default: () => new Date() },
      },
    ],
    default: [],
    name: 'fcm_tokens',
  })
  fcmTokens?: { token: string; platform: string; updatedAt: Date }[];

  /** Compte Stripe Connect Express (vendeur). */
  @Prop({ required: false, name: 'stripe_connect_account_id', trim: true })
  stripeConnectAccountId?: string;

  @Prop({
    required: false,
    name: 'stripe_connect_charges_enabled',
    default: false,
  })
  stripeConnectChargesEnabled?: boolean;

  @Prop({
    required: false,
    name: 'stripe_connect_payouts_enabled',
    default: false,
  })
  stripeConnectPayoutsEnabled?: boolean;

  @Prop({
    required: false,
    name: 'stripe_connect_details_submitted',
    default: false,
  })
  stripeConnectDetailsSubmitted?: boolean;

  @Prop({ required: false, name: 'stripe_connect_disabled_reason', trim: true })
  stripeConnectDisabledReason?: string;

  @Prop({
    required: false,
    name: 'stripe_connect_requirements_due',
    type: [String],
    default: [],
  })
  stripeConnectRequirementsDue?: string[];

  @Prop({
    required: false,
    name: 'stripe_connect_requirements_past_due',
    type: [String],
    default: [],
  })
  stripeConnectRequirementsPastDue?: string[];

  /**
   * Affiliation : Partner qui a référé ce compte (client / vendeur / livreur).
   * Renseigné via code referral ou attach.
   */
  @Prop({
    type: Types.ObjectId,
    ref: 'UserModel',
    required: false,
    name: 'referred_by_partner_user_id',
    index: true,
  })
  referredByPartnerUserId?: Types.ObjectId;

  @Prop({
    required: false,
    name: 'referred_by_partner_code',
    trim: true,
    uppercase: true,
  })
  referredByPartnerCode?: string;

  /** Badge partenaire livreur (Silver / Gold / Diamond) — délai de versement Stripe. */
  @Prop({
    required: false,
    name: 'partner_badge_code',
    trim: true,
    uppercase: true,
    default: PartnerBadgeCode.SILVER,
  })
  partnerBadgeCode?: string;

  // @Prop({
  //   get: (creditCardNumber: string) => {
  //     if (!creditCardNumber) {
  //       return;
  //     }
  //     const lastFourDigits = creditCardNumber.slice(
  //       creditCardNumber.length - 4,
  //     );
  //     return `****-****-****-${lastFourDigits}`;
  //   },
  // })
  // creditCardNumber?: string;
}

export const UserSchema = SchemaFactory.createForClass(UserModel);

UserSchema.virtual('hasStore').get(function () {
  return (this.stores || []).length > 0;
});

UserSchema.virtual('defaultStore').get(function () {
  return (this.stores || []).length > 0 ? this.stores[0] : null;
});

UserSchema.pre('save', async function (next) {
  try {
    if (!this.isModified('password')) {
      return next();
    }
    const pwd = String(this['password'] ?? '');
    /** Déjà hashé (ex. finalisation inscription depuis `pending_signups`). */
    if (
      pwd.startsWith('$2a$') ||
      pwd.startsWith('$2b$') ||
      pwd.startsWith('$2y$')
    ) {
      return next();
    }
    const hashed = await hashPassword(pwd);
    this['password'] = hashed;
    return next();
  } catch (error) {
    return next(error);
  }
});

export type UserModelDocument = UserModel & Document;
