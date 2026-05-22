import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'store_roles' })
export class StoreRoleModel {
  @Prop({ type: Types.ObjectId, ref: 'StoreModel', required: true, index: true })
  store: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, trim: true, default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ type: String, trim: true, sparse: true })
  templateKey?: string;

  @Prop({ type: Boolean, default: false })
  isOwnerRole: boolean;

  @Prop({ type: Boolean, default: false })
  isSystem: boolean;
}

export type StoreRoleDocument = HydratedDocument<StoreRoleModel>;

export const StoreRoleSchema = SchemaFactory.createForClass(StoreRoleModel);
StoreRoleSchema.index({ store: 1, name: 1 });
