import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Paramètres plateforme — gestion stock ingrédients (document singleton `key=default`). */
@Schema({ timestamps: true, collection: 'stock_manager_settings' })
export class StockManagerSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: Boolean, default: false })
  ingredientStockManagementEnabled: boolean;
}

export type StockManagerSettingsDocument =
  HydratedDocument<StockManagerSettingsModel>;

export const StockManagerSettingsSchema = SchemaFactory.createForClass(
  StockManagerSettingsModel,
);
