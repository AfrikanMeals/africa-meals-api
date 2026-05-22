import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'platform_roles' })
export class PlatformRoleModel {
  @Prop({ type: String, required: true, trim: true, unique: true })
  name: string;

  @Prop({ type: String, trim: true, default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ type: String, trim: true, sparse: true })
  templateKey?: string;

  @Prop({ type: Boolean, default: false })
  isSuper: boolean;

  @Prop({ type: Boolean, default: false })
  isSystem: boolean;
}

export type PlatformRoleDocument = HydratedDocument<PlatformRoleModel>;

export const PlatformRoleSchema =
  SchemaFactory.createForClass(PlatformRoleModel);
