import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';

/** Abonnement client → boutique (notifications / suivi). */
@Schema({ timestamps: true, collection: 'store_subscribers' })
export class StoreSubscriberModel {
  @Prop({
    type: Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    index: true,
  })
  store: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: UserModel.name,
    required: true,
    index: true,
  })
  user: Types.ObjectId;
}

export type StoreSubscriberDocument = HydratedDocument<StoreSubscriberModel>;

export const StoreSubscriberSchema = SchemaFactory.createForClass(
  StoreSubscriberModel,
);

StoreSubscriberSchema.index({ store: 1, user: 1 }, { unique: true });
