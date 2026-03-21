import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Type } from 'class-transformer';
import { Schema as MongooseSchema } from 'mongoose';
import { AddressModel } from './address.schema';
import { BaseSchema } from './base.schema';
import { PaymentMethodModel } from './payment-method.schema';
import { StoreModel } from './store.schema';

export enum UserTypeEnum {
  /** Client final (inscription « Client ») */
  USER = 'USER',
  /** Restaurant / vendeur (inscription « Restaurant / Vendeur ») */
  VENDOR = 'VENDOR',
  /** Livreur (inscription « Livreur ») */
  DELIVERY = 'DELIVERY',
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

  @Prop({ required: true, name: 'full_name' })
  fullName: string;

  @Prop({ required: true, name: 'email', unique: true })
  email: string;

  @Prop({ required: false, name: 'phone_number' })
  phoneNumber?: string;

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

  @Prop({ required: false, name: 'facebook_id' })
  facebookId?: string;

  @Prop({ required: false, name: 'google_id' })
  googleId?: string;

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
    ref: StoreModel.name,
    default: [],
  })
  @Type(() => Array<StoreModel>)
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

  @Prop({ required: false, name: 'password_reset_code', select: false })
  passwordResetCode?: string;

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
    if (pwd.startsWith('$2a$') || pwd.startsWith('$2b$') || pwd.startsWith('$2y$')) {
      return next();
    }
    const hashed = await bcrypt.hash(pwd, 10);
    this['password'] = hashed;
    return next();
  } catch (error) {
    return next(error);
  }
});

export type UserModelDocument = UserModel & Document;
