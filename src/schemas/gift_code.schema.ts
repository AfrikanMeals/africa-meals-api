import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Document, Types } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';

export enum GiftCodeDiscountTypeEnum {
  FIXED = 'FIXED',
  PERCENTAGE = 'PERCENTAGE',
}

export enum GiftCodeScopeTypeEnum {
  ALL = 'all',
  REGION = 'region',
  SPECIFIC = 'specific',
}

/** Catégorie affichée dans le catalogue client (filtres Promos). */
export enum GiftCodePromoTypeEnum {
  DISCOUNT = 'DISCOUNT',
  CASHBACK = 'CASHBACK',
  PARTNERSHIP = 'PARTNERSHIP',
}

@Schema({
  timestamps: true,
  collection: 'gift_codes',
  toJSON: { virtuals: true },
})
export class GiftCodeModel extends BaseSchema {
  /** Code promo saisi par l'admin – stocké en majuscules. */
  @Prop({ required: true, uppercase: true, trim: true, unique: true })
  code: string;

  /** Portée : toutes les boutiques ('all'), régions ('region') ou liste précise ('specific'). */
  @Prop({
    required: true,
    enum: GiftCodeScopeTypeEnum,
    default: GiftCodeScopeTypeEnum.ALL,
  })
  scopeType: GiftCodeScopeTypeEnum;

  /** Références boutiques – pertinent uniquement si scopeType === 'specific'. */
  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: StoreModel.name }])
  storeIds: Types.ObjectId[];

  /** Codes région ISO2 – pertinent uniquement si scopeType === 'region'. */
  @Prop({ type: [String], default: [] })
  regionCodes: string[];

  @Prop({ required: true, enum: GiftCodeDiscountTypeEnum })
  discountType: GiftCodeDiscountTypeEnum;

  /** Type marketing (filtre catalogue : remise, cashback, partenariat…). */
  @Prop({
    required: true,
    enum: GiftCodePromoTypeEnum,
    default: GiftCodePromoTypeEnum.DISCOUNT,
  })
  promoType: GiftCodePromoTypeEnum;

  /** Titre carte catalogue client. */
  @Prop({ required: false, trim: true, maxlength: 120 })
  title?: string;

  /** Sous-titre carte catalogue client. */
  @Prop({ required: false, trim: true, maxlength: 280 })
  subtitle?: string;

  /** Image de couverture (URL HTTPS). */
  @Prop({ required: false, trim: true })
  imageUrl?: string;

  /** Montant devise (FIXED) ou pourcentage 1–100 (PERCENTAGE). */
  @Prop({ required: true })
  value: number;

  @Prop({ required: true })
  validFrom: Date;

  @Prop({ required: true })
  validUntil: Date;

  @Prop({ default: true })
  enabled: boolean;

  /** Compteur total d'utilisations (toutes boutiques / tous utilisateurs). */
  @Prop({ default: 0 })
  usedCount: number;

  /** Date d'envoi de la notification d'activation (email + push) à tous les clients. */
  @Prop({ required: false, type: Date, name: 'activation_notified_at' })
  activationNotifiedAt?: Date;

  /** Limite globale d'utilisations (null = illimité). */
  @Prop({ required: false })
  maxUses?: number;

  /** Limite par utilisateur (null = illimité). */
  @Prop({ required: false })
  maxUsesPerUser?: number;

  /** Suivi des utilisations par userId pour enforcement du quota par user. */
  @Prop({
    type: [
      {
        _id: false,
        userId: { type: MongooseSchema.Types.ObjectId, required: true },
        count: { type: Number, required: true, default: 0 },
      },
    ],
    default: [],
  })
  userUsages: { userId: Types.ObjectId; count: number }[];
}

export const GiftCodeSchema = SchemaFactory.createForClass(GiftCodeModel);

GiftCodeSchema.index({ code: 1 }, { unique: true });
GiftCodeSchema.index({ storeIds: 1 });
GiftCodeSchema.index({ regionCodes: 1 });

GiftCodeSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export type GiftCodeModelDocument = GiftCodeModel & Document;
