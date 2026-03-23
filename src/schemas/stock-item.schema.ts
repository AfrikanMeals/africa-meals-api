import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';

export enum StockStatutEnum {
  OK = 'ok',
  ALERTE = 'alerte',
}

@Schema({
  timestamps: true,
  /** Aligné sur les imports manuels Compass ; l’ancienne collection `stock_items` est encore lue côté service. */
  collection: 'stocks',
  toJSON: { getters: true, virtuals: true },
})
export class StockItemModel extends BaseSchema {
  @Prop({ required: true })
  produit: string;

  @Prop({ required: true })
  unite: string;

  @Prop({ required: true, default: 0 })
  quantite: number;

  @Prop({ required: true, default: 0 })
  seuil: number;

  /** Prix unitaire (ex. FCFA par kg / par pièce selon l’unité). */
  @Prop({ required: true, default: 0, min: 0 })
  prix: number;

  @Prop({
    required: true,
    enum: StockStatutEnum,
    default: StockStatutEnum.OK,
  })
  statut: StockStatutEnum;

  @Prop({
    required: true,
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
  })
  store: StoreModel;
}

export const StockItemSchema = SchemaFactory.createForClass(StockItemModel);

