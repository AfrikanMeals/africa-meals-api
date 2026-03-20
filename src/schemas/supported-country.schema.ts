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

  @Prop({ default: true })
  active: boolean;
}

export const SupportedCountrySchema = SchemaFactory.createForClass(
  SupportedCountryModel,
);
