import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const STORE_MEMBER_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type StoreMemberStatus = (typeof STORE_MEMBER_STATUSES)[number];

@Schema({ timestamps: true, collection: 'store_members' })
export class StoreMemberModel {
  @Prop({ type: Types.ObjectId, ref: 'StoreModel', required: true, index: true })
  store: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', required: true, index: true })
  user: Types.ObjectId;

  /** @deprecated Utiliser `roles` — conservé pour migration. */
  @Prop({ type: Types.ObjectId, ref: 'StoreRoleModel', required: false })
  role?: Types.ObjectId;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'StoreRoleModel' }],
    default: [],
  })
  roles: Types.ObjectId[];

  @Prop({
    type: String,
    enum: STORE_MEMBER_STATUSES,
    default: 'ACTIVE',
  })
  status: StoreMemberStatus;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', required: false })
  invitedBy?: Types.ObjectId;
}

export type StoreMemberDocument = HydratedDocument<StoreMemberModel>;

export const StoreMemberSchema = SchemaFactory.createForClass(StoreMemberModel);
StoreMemberSchema.index({ store: 1, user: 1 }, { unique: true });
StoreMemberSchema.index({ user: 1, status: 1 });
