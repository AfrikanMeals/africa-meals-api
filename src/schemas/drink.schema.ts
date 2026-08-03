import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { AdModerationStatusEnum } from './ad-moderation-status.enum';
import { ProductCategoryModel } from './product-category.schema';
import { ProductDiscountScheduleModel } from './product.schema';
import { StoreModel } from './store.schema';

export enum DrinkStatutEnum {
  OK = 'ok',
  ALERTE = 'alerte',
}

@Schema({
  timestamps: true,
  collection: 'drinks',
  toJSON: { getters: true, virtuals: true },
})
export class DrinkModel extends BaseSchema {
  @Prop({ required: true, name: 'name' })
  name: string;

  @Prop({ required: false, name: 'description' })
  description?: string;

  @Prop({ required: true, default: 0, name: 'quantite', min: 0 })
  quantite: number;

  @Prop({ required: true, default: 0, name: 'seuil', min: 0 })
  seuil: number;

  /** Prix catalogue effectif (muté par le cron de fenêtres promo). */
  @Prop({ required: true, default: 0, name: 'price_cad', min: 0 })
  priceCad: number;

  /** Promo effective (0 = aucune) — miroir Food `discountPrice`. */
  @Prop({ required: false, name: 'discount_price', default: 0, min: 0 })
  discountPrice?: number;

  /** Baseline hors fenêtre planifiée (restaurée par le cron). */
  @Prop({ required: false, name: 'list_price', min: 0 })
  listPrice?: number;

  @Prop({ required: false, name: 'list_discount_price', default: 0, min: 0 })
  listDiscountPrice?: number;

  @Prop({
    default: [],
    name: 'discount_schedules',
    type: [ProductDiscountScheduleModel],
  })
  discountSchedules: ProductDiscountScheduleModel[];

  /**
   * Stratégie commission pour cette boisson uniquement.
   * Absent / null → hérite de la boutique, sinon défaut `on_payout`.
   */
  @Prop({
    required: false,
    name: 'commission_retrieve_strategy',
    enum: ['on_payout', 'add_to_price'],
  })
  commissionRetrieveStrategy?: 'on_payout' | 'add_to_price' | null;

  @Prop({
    required: true,
    enum: DrinkStatutEnum,
    default: DrinkStatutEnum.OK,
    name: 'statut',
  })
  statut: DrinkStatutEnum;

  /** URL publique (ex. Firebase Storage) après upload. */
  @Prop({ required: false, name: 'image_url' })
  imageUrl?: string;

  /** Catégorie catalogue boisson (ex. Boissons naturelles, Vins). */
  @Prop({
    required: false,
    ref: ProductCategoryModel.name,
    type: MongooseSchema.Types.ObjectId,
    name: 'category',
  })
  category?: ProductCategoryModel;

  @Prop({
    required: true,
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
    name: 'store',
  })
  store: StoreModel;

  /** Modération admin — blocage avec motif (contenu créé par vendeur). */
  @Prop({
    required: false,
    enum: AdModerationStatusEnum,
    default: AdModerationStatusEnum.APPROVED,
    name: 'moderation_status',
  })
  moderationStatus?: AdModerationStatusEnum;

  @Prop({ required: false, maxlength: 500, name: 'moderation_block_reason' })
  moderationBlockReason?: string;

  @Prop({ required: false, default: null, name: 'moderation_reviewed_at' })
  moderationReviewedAt?: Date | null;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    default: null,
    name: 'moderation_reviewed_by',
  })
  moderationReviewedBy?: MongooseSchema.Types.ObjectId | null;
}

export const DrinkSchema = SchemaFactory.createForClass(DrinkModel);
