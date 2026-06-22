import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class PlatformSurfaceModulesModel {
  @Prop({ type: Boolean, default: true })
  deliveryTools: boolean;

  @Prop({ type: Boolean, default: true })
  pickup: boolean;

  @Prop({ type: Boolean, default: true })
  marketing: boolean;

  @Prop({ type: Boolean, default: true })
  vendorTools: boolean;

  @Prop({ type: Boolean, default: true })
  deliveryAgent: boolean;

  @Prop({ type: Boolean, default: true })
  chat: boolean;
}

export const PlatformSurfaceModulesSchema = SchemaFactory.createForClass(
  PlatformSurfaceModulesModel,
);

/** Document singleton `key=default` — modules par surface (admin / mobile). */
@Schema({ timestamps: true, collection: 'platform_feature_modules' })
export class PlatformFeatureModulesModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({
    type: PlatformSurfaceModulesSchema,
    default: () => ({}),
  })
  admin: PlatformSurfaceModulesModel;

  @Prop({
    type: PlatformSurfaceModulesSchema,
    default: () => ({}),
  })
  mobile: PlatformSurfaceModulesModel;
}

export type PlatformFeatureModulesDocument =
  HydratedDocument<PlatformFeatureModulesModel>;

export const PlatformFeatureModulesSchema = SchemaFactory.createForClass(
  PlatformFeatureModulesModel,
);
