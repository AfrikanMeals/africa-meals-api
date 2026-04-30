import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Document } from 'mongoose';
import { BaseSchema } from './base.schema';
import { ProductModel } from './product.schema';
import { StoreModel } from './store.schema';

/** Cible du tap sur la bannière (boutique ou fiche produit). */
export enum StoreAdActionTypeEnum {
  SHOP = 'SHOP',
  PRODUCT = 'PRODUCT',
}

@Schema({
  timestamps: true,
  collection: 'ads',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AdModel extends BaseSchema {
  @Prop({ default: true, name: 'is_active' })
  isActive: boolean;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, name: 'subtitle' })
  subtitle: string;

  @Prop({ required: true, name: 'action_text' })
  actionText: string;

  @Prop({ required: false, name: 'image_url' })
  imageUrl?: string;

  @Prop({ default: 0, name: 'sort_order' })
  sortOrder: number;

  /** Si absent : bannière globale (accueil). Sinon : boutique propriétaire. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: false,
  })
  store?: MongooseSchema.Types.ObjectId;

  @Prop({ required: false })
  validFrom?: Date;

  @Prop({ required: false })
  validUntil?: Date;

  @Prop({
    required: false,
    enum: StoreAdActionTypeEnum,
  })
  actionType?: StoreAdActionTypeEnum;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: ProductModel.name,
    required: false,
  })
  product?: MongooseSchema.Types.ObjectId;
}

export const AdSchema = SchemaFactory.createForClass(AdModel);

AdSchema.index({ store: 1, sortOrder: 1 });

AdSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export type AdModelDocument = AdModel & Document;
