import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

/** Détail par boutique après traitement webhook (commande + montants Stripe). */
export type StripePerStoreBreakdownRow = {
  storeId: string;
  orderId?: string;
  goodsCents: number;
  shipCents: number;
  couponCode?: string;
  error?: string;
  transferId?: string;
  transferCents?: number;
  platformFeeCents?: number;
  transferSkippedReason?: string;
};

/**
 * Idempotence webhook Stripe : `checkout.session.completed` (id `cs_…`)
 * ou `payment_intent.succeeded` (id `pi_…`).
 */
@Schema({
  collection: 'stripe_processed_checkouts',
  timestamps: true,
})
export class StripeProcessedCheckoutModel {
  /** `cs_…` (Checkout) ou `pi_…` (PaymentIntent / wallets). */
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

  /** Montant total encaissé (centimes), tel que renvoyé par Stripe. */
  @Prop({ required: false })
  amountTotalCents?: number;

  @Prop({ required: false, trim: true })
  currency?: string;

  /** `checkout_session` | `payment_intent` */
  @Prop({ required: false, trim: true })
  stripeEventKind?: string;

  /**
   * Transaction unifiée : une ligne par boutique (montants Stripe + id commande).
   */
  @Prop({ type: [MongooseSchema.Types.Mixed], required: false })
  perStoreBreakdown?: StripePerStoreBreakdownRow[];
}

export type StripeProcessedCheckoutDocument = StripeProcessedCheckoutModel &
  Document;

export const StripeProcessedCheckoutSchema = SchemaFactory.createForClass(
  StripeProcessedCheckoutModel,
);
