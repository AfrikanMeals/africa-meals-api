import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

@Schema({
  timestamps: true,
  collection: 'supported_countries',
})
export class SupportedCountryModel extends BaseSchema {
  @Prop({ required: true, unique: true, uppercase: true })
  code: string;

  @Prop({ required: true })
  name: string;

  /** Région ISO pour libphonenumber (ex. CA, SN, FR) */
  @Prop({ required: true })
  phoneRegion: string;

  /** Devise principale utilisée dans l’app pour ce pays (ISO 4217, ex. CAD, XOF). */
  @Prop({ required: true, uppercase: true, default: 'CAD' })
  currency: string;

  @Prop({ default: true })
  active: boolean;
}

export const SupportedCountrySchema = SchemaFactory.createForClass(
  SupportedCountryModel,
);
