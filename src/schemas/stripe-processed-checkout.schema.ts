import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

/** Idempotence webhook Stripe `checkout.session.completed`. */
@Schema({
  collection: 'stripe_processed_checkouts',
  timestamps: true,
})
export class StripeProcessedCheckoutModel {
  @Prop({ required: true, unique: true, index: true })
  sessionId: string;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: [String], default: [] })
  orderIds: string[];
}

export type StripeProcessedCheckoutDocument = StripeProcessedCheckoutModel &
  Document;

export const StripeProcessedCheckoutSchema = SchemaFactory.createForClass(
  StripeProcessedCheckoutModel,
);
