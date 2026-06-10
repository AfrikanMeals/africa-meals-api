import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class PlatformBusinessTypeItemModel {
  @Prop({ type: String, required: true })
  slug: string;

  @Prop({ type: String, required: true })
  labelFr: string;

  @Prop({ type: String, required: true })
  labelEn: string;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const PlatformBusinessTypeItemSchema = SchemaFactory.createForClass(
  PlatformBusinessTypeItemModel,
);

/** Types d'établissement configurables (document singleton `key=default`). */
@Schema({ timestamps: true, collection: 'platform_business_types' })
export class PlatformBusinessTypesModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: [PlatformBusinessTypeItemSchema], default: [] })
  types: PlatformBusinessTypeItemModel[];
}

export type PlatformBusinessTypesDocument =
  HydratedDocument<PlatformBusinessTypesModel>;

export const PlatformBusinessTypesSchema = SchemaFactory.createForClass(
  PlatformBusinessTypesModel,
);
