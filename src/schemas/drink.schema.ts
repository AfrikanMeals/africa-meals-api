import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
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

  /** Prix affiché / facturé en dollars canadiens (CAD). */
  @Prop({ required: true, default: 0, name: 'price_cad', min: 0 })
  priceCad: number;

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

  @Prop({
    required: true,
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
    name: 'store',
  })
  store: StoreModel;
}

export const DrinkSchema = SchemaFactory.createForClass(DrinkModel);
