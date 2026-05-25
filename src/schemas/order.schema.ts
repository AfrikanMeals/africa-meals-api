import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { CartItemTypeEnum } from './cart_item.schema';
import { StoreModel } from './store.schema';

export enum OrderStatusEnum {
  CREATED = 'created', // WHEN ORDER IS CREATED
  PAIED = 'paied', // WHEN ORDER IS PAID
  APPROVED = 'approved', // WHEN ORDER IS APPROVED BY STORE
  CANCELLED = 'cancelled', // WHEN ORDER IS CANCELLED BY STORE
  SHIPPED = 'shipped', // WHEN ORDER IS SHIPPED BY STORE
  COMPLETED = 'completed', // WHEN ORDER IS COMPLETED
}

/** Statut d’une entrée du journal de demande de remboursement (côté client → admin). */
export enum OrderRefundRequestEntryStatusEnum {
  PENDING = 'pending',
  /** En pause — le cron n’essaie pas de traiter (décision admin). */
  PAUSED = 'paused',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
}

@Schema({
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class OrdeLineItem {
  @Prop({ required: true, name: 'label' })
  label: string;

  @Prop({ required: false, name: 'picture_url' })
  pictureUrl?: string;

  @Prop({
    required: true,
    name: 'item_type',
    enum: CartItemTypeEnum,
  })
  itemType: CartItemTypeEnum;

  @Prop({ required: true, name: 'price' })
  price: number;

  @Prop({ required: true, name: 'quantity' })
  quantity: number;

  /** Libellé de la catégorie produit au moment de la commande (ex. menu / plat). */
  @Prop({ required: false, name: 'category_title' })
  categoryTitle?: string;
}

@Schema({
  timestamps: true,
  collection: 'orders',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class OrderModel extends BaseSchema {
  @Prop({ required: false, name: 'should_ship', default: false })
  shouldShip?: boolean;

  /** Livreur plateforme (compte `DELIVERY`) ayant pris la course. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: false,
    name: 'assigned_delivery_user',
    index: true,
  })
  assignedDeliveryUser?: MongooseSchema.Types.ObjectId;

  /** Code à présenter en boutique (commandes retrait, généré au paiement). */
  @Prop({ required: false, name: 'pickup_code', trim: true, uppercase: true })
  pickupCode?: string;

  /** Date/heure de remise au client (retrait confirmé). */
  @Prop({ required: false, name: 'picked_up_at', type: Date })
  pickedUpAt?: Date;

  /** Code motif annulation / refus (`out_of_stock`, `changed_mind`, `other`, …). */
  @Prop({ required: false, name: 'cancel_reason_code', trim: true, maxlength: 64 })
  cancelReasonCode?: string;

  /** Libellé lisible ou précision (motif personnalisé si `other`). */
  @Prop({
    required: false,
    name: 'cancel_reason_details',
    trim: true,
    maxlength: 4000,
  })
  cancelReasonDetails?: string;

  /** Origine du motif : vendeur, client ou admin. */
  @Prop({
    required: false,
    name: 'cancel_reason_source',
    enum: ['vendor', 'client', 'admin'],
  })
  cancelReasonSource?: 'vendor' | 'client' | 'admin';

  @Prop({
    required: true,
    name: 'store',
    type: MongooseSchema.Types.ObjectId,
    ref: 'StoreModel',
  })
  store: StoreModel;

  @Prop({
    required: true,
    name: 'status',
    enum: OrderStatusEnum,
    default: OrderStatusEnum.CREATED,
  })
  status: OrderStatusEnum;

  @Prop({ required: false, name: 'shipping_price', default: 0 })
  shippingPrice?: number;

  @Prop({ required: true, name: 'total_price' })
  totalPrice: number;

  /** Points fidélité déjà crédités pour cette commande (évite double crédit). */
  @Prop({ default: false, name: 'loyalty_points_credited' })
  loyaltyPointsCredited?: boolean;

  @Prop({
    required: true,
    name: 'user',
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
  })
  user: string;

  @Prop({
    required: true,
    name: 'items',
    type: Array<OrdeLineItem>,
    default: [],
    validate: {
      validator: (value: OrdeLineItem[]) => {
        return ((value as OrdeLineItem[]) || [])?.length > 0;
      },
    },
  })
  items: OrdeLineItem[];

  /** `cs_…` ou `pi_…` du paiement Stripe groupé ayant déclenché la commande. */
  @Prop({ required: false, name: 'stripe_parent_payment_id' })
  stripeParentPaymentId?: string;

  /** Code promo boutique appliqué au moment du paiement (si présent). */
  @Prop({ required: false, name: 'coupon_code' })
  couponCode?: string;

  /** Montant articles encaissé via Stripe (centimes), pour alignement avec le paiement groupé. */
  @Prop({ required: false, name: 'stripe_charged_goods_cents' })
  stripeChargedGoodsCents?: number;

  /** Portion livraison encaissée via Stripe (centimes). */
  @Prop({ required: false, name: 'stripe_charged_ship_cents' })
  stripeChargedShipCents?: number;

  /** Transfer Connect vers le vendeur (`tr_…`). */
  @Prop({ required: false, name: 'stripe_transfer_id' })
  stripeTransferId?: string;

  /** Montant transféré au compte Connect (centimes). */
  @Prop({ required: false, name: 'stripe_transfer_amount_cents' })
  stripeTransferAmountCents?: number;

  /** Commission plateforme retenue sur la commande (centimes). */
  @Prop({ required: false, name: 'platform_fee_cents' })
  platformFeeCents?: number;

  /** Part des frais Stripe processing imputée au transfer vendeur (centimes). */
  @Prop({ required: false, name: 'stripe_processing_fee_cents' })
  stripeProcessingFeeCents?: number;

  /** Transfer Connect vers le livreur (`tr_…`) — part livraison. */
  @Prop({ required: false, name: 'stripe_delivery_transfer_id' })
  stripeDeliveryTransferId?: string;

  @Prop({ required: false, name: 'stripe_delivery_transfer_amount_cents' })
  stripeDeliveryTransferAmountCents?: number;

  @Prop({ required: false, name: 'stripe_delivery_processing_fee_cents' })
  stripeDeliveryProcessingFeeCents?: number;

  @Prop({ required: false, name: 'stripe_delivery_transfer_reversal_id' })
  stripeDeliveryTransferReversalId?: string;

  @Prop({
    required: false,
    name: 'stripe_delivery_transfer_reversal_amount_cents',
  })
  stripeDeliveryTransferReversalAmountCents?: number;

  /** Dernier reversal de transfer (`trr_…` / id reversal). */
  @Prop({ required: false, name: 'stripe_transfer_reversal_id' })
  stripeTransferReversalId?: string;

  /** Total des reversals sur le transfer (centimes). */
  @Prop({ required: false, name: 'stripe_transfer_reversal_amount_cents' })
  stripeTransferReversalAmountCents?: number;

  /**
   * Journal des demandes de remboursement (historique). Dernière entrée la plus récente.
   * Une seule entrée `pending` à la fois ; `approved` / `completed` = traitement encours ou terminé.
   */
  @Prop({
    type: [
      {
        status: {
          type: String,
          enum: Object.values(OrderRefundRequestEntryStatusEnum),
          required: true,
          default: OrderRefundRequestEntryStatusEnum.PENDING,
        },
        details: { type: String, required: true, maxlength: 4000 },
        requestedAt: { type: Date, required: true, default: () => new Date() },
        resolvedAt: { type: Date, required: false },
        resolutionNote: { type: String, required: false, maxlength: 4000 },
        stripeRefundId: { type: String, required: false, maxlength: 128 },
        refundGrossCents: { type: Number, required: false },
        platformRefundFeeCents: { type: Number, required: false },
        /** Frais plateforme imposés au client (centimes), défini par l’admin ; absent = barème. */
        platformRefundFeeOverrideCents: { type: Number, required: false },
        customerRefundCents: { type: Number, required: false },
        /** Frais Stripe processing sur la charge (centimes, total paiement). */
        stripeProcessingFeeCents: { type: Number, required: false },
        /** Part des frais Stripe déduite du remboursement client (centimes). */
        stripeProcessingFeeOnCustomerCents: { type: Number, required: false },
        /** Pénalité imputée au restaurant (centimes), ex. annulation vendeur. */
        vendorPenaltyCents: { type: Number, required: false },
        processedBy: {
          type: String,
          required: false,
          enum: ['cron', 'admin'],
        },
        adminUserId: {
          type: MongooseSchema.Types.ObjectId,
          required: false,
          ref: 'UserModel',
        },
      },
    ],
    default: [],
    name: 'refund_request_log',
  })
  refundRequestLog?: Array<{
    status: OrderRefundRequestEntryStatusEnum;
    details: string;
    requestedAt: Date;
    resolvedAt?: Date;
    resolutionNote?: string;
    stripeRefundId?: string;
    refundGrossCents?: number;
    platformRefundFeeCents?: number;
    platformRefundFeeOverrideCents?: number;
    customerRefundCents?: number;
    stripeProcessingFeeCents?: number;
    stripeProcessingFeeOnCustomerCents?: number;
    vendorPenaltyCents?: number;
    processedBy?: 'cron' | 'admin';
    adminUserId?: string;
  }>;
}

export const OrderSchema = SchemaFactory.createForClass(OrderModel);

export type OrderModelDocument = OrderModel & Document;
