import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema } from './base.schema';
import { CartItemTypeEnum } from './cart_item.schema';
import {
  LineComplementGroupSnapshot,
  LineComplementGroupSnapshotSchema,
  LineSupplementSnapshot,
  LineSupplementSnapshotSchema,
} from './order-line-customization.schema';
import { StoreModel } from './store.schema';

export enum OrderStatusEnum {
  CREATED = 'created', // WHEN ORDER IS CREATED
  PAIED = 'paied', // WHEN ORDER IS PAID
  /** Paiement cash au retrait en boutique — en attente d’encaissement. */
  AWAITING_CASH = 'awaiting_cash',
  APPROVED = 'approved', // WHEN ORDER IS APPROVED BY STORE
  CANCELLED = 'cancelled', // WHEN ORDER IS CANCELLED BY STORE
  SHIPPED = 'shipped', // WHEN ORDER IS SHIPPED BY STORE
  COMPLETED = 'completed', // WHEN ORDER IS COMPLETED
}

/** Cycle de vie du pourboire livreur sur une commande. */
export enum DeliveryTipStatusEnum {
  NONE = 'none',
  PENDING = 'pending',
  TRANSFERRED = 'transferred',
  REFUNDED = 'refunded',
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

@Schema({ _id: false })
export class OrderDeliveryAddressSnapshot {
  @Prop({ required: false })
  label?: string;

  @Prop({ required: true })
  address: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  country: string;

  @Prop({ required: true, name: 'country_code' })
  countryCode: string;

  @Prop({ required: true, name: 'zip_code' })
  zipCode: string;

  @Prop({
    type: {
      type: MongooseSchema.Types.String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
    },
  })
  location?: {
    type: string;
    coordinates: number[];
  };
}

export const OrderDeliveryAddressSnapshotSchema = SchemaFactory.createForClass(
  OrderDeliveryAddressSnapshot,
);

@Schema({ _id: false })
export class OrderTaxLineSnapshot {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: false, trim: true })
  description?: string;

  @Prop({ required: true, enum: ['percent', 'fixed'] })
  feeType: 'percent' | 'fixed';

  @Prop({ required: true })
  feeValue: number;

  @Prop({ type: [String], default: [] })
  modules: string[];

  @Prop({ required: true })
  amount: number;
}

export const OrderTaxLineSnapshotSchema = SchemaFactory.createForClass(
  OrderTaxLineSnapshot,
);

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

  /** Référence entité source (produit/boisson/offre) pour analytics et attribution pub. */
  @Prop({ required: false, name: 'entity_id' })
  entityId?: string;

  @Prop({ required: true, name: 'price' })
  price: number;

  /**
   * Stratégie commission effective figée à la commande
   * (priorité item → boutique → on_payout).
   */
  @Prop({
    required: false,
    name: 'commission_retrieve_strategy',
    enum: ['on_payout', 'add_to_price'],
  })
  commissionRetrieveStrategy?: 'on_payout' | 'add_to_price';

  @Prop({ required: true, name: 'quantity' })
  quantity: number;

  /** Libellé de la catégorie produit au moment de la commande (ex. menu / plat). */
  @Prop({ required: false, name: 'category_title' })
  categoryTitle?: string;

  /** Compléments choisis (figés à la commande). */
  @Prop({
    type: [LineComplementGroupSnapshotSchema],
    default: [],
    name: 'selected_complements',
  })
  selectedComplements?: LineComplementGroupSnapshot[];

  /** Suppléments choisis (figés à la commande). */
  @Prop({
    type: [LineSupplementSnapshotSchema],
    default: [],
    name: 'selected_supplements',
  })
  selectedSupplements?: LineSupplementSnapshot[];

  /** Variante de prix choisie (figée à la commande). */
  @Prop({ required: false, name: 'selected_variant_label', trim: true })
  selectedVariantLabel?: string;

  /** Bundle source (lignes combo) — pour regroupement facture / admin. */
  @Prop({
    required: false,
    name: 'bundle_id',
    type: MongooseSchema.Types.ObjectId,
  })
  // Types.ObjectId (instance) — pas MongooseSchema.Types.ObjectId (classe schéma TS).
  bundleId?: Types.ObjectId;

  /** UUID du groupe combo (1 groupe = 1 unité bundle). */
  @Prop({ required: false, name: 'bundle_group_id', trim: true })
  bundleGroupId?: string;

  /** Titre combo figé à la commande (affichage groupé). */
  @Prop({ required: false, name: 'bundle_title', trim: true })
  bundleTitle?: string;
}

@Schema({
  timestamps: true,
  collection: 'orders',
  // getters : Prop `name` snake → camel aussi via toObject (findOneById / field selection).
  toJSON: {
    getters: true,
    virtuals: true,
  },
  toObject: {
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

  /** Motif du dernier retrait livreur (`courier_abandon`, `vendor_unassign`, …). */
  @Prop({
    required: false,
    name: 'delivery_unassign_reason',
    enum: ['courier_abandon', 'vendor_unassign', 'admin_unassign'],
    maxlength: 32,
  })
  deliveryUnassignReason?:
    | 'courier_abandon'
    | 'vendor_unassign'
    | 'admin_unassign';

  /** Horodatage du dernier retrait livreur. */
  @Prop({ required: false, name: 'delivery_unassigned_at' })
  deliveryUnassignedAt?: Date;

  /** Livreur retiré (conservé après `assignedDeliveryUser` effacé — stats performance). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: false,
    name: 'delivery_unassigned_from_user',
    index: true,
  })
  deliveryUnassignedFromUser?: MongooseSchema.Types.ObjectId;

  /** Acteur du retrait (livreur, vendeur ou admin). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: false,
    name: 'delivery_unassigned_by_user',
  })
  deliveryUnassignedByUser?: MongooseSchema.Types.ObjectId;

  /** Course abandonnée par le livreur — exclue des gains / transferts Stripe. */
  @Prop({ required: false, name: 'courier_abandon_no_payout', default: false })
  courierAbandonNoPayout?: boolean;

  /** Code à présenter en boutique (commandes retrait, généré au paiement). */
  @Prop({ required: false, name: 'pickup_code', trim: true, uppercase: true })
  pickupCode?: string;

  /** Horodatage de l’envoi du message vendeur « commande payée » (évite les doublons / retry Stripe). */
  @Prop({ required: false, name: 'vendor_paid_notified_at' })
  vendorPaidNotifiedAt?: Date;

  /** Vendeur a accepté la commande et la prépare (statut reste `paied`). */
  @Prop({ required: false, name: 'vendor_accepted_at', type: Date })
  vendorAcceptedAt?: Date;

  /** Date/heure de remise au client (retrait confirmé). */
  @Prop({ required: false, name: 'picked_up_at', type: Date })
  pickedUpAt?: Date;

  /** Preuve livraison « client absent » en cours de validation. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'PendingDeliveryProofModel',
    required: false,
    name: 'pending_delivery_proof_id',
    index: true,
  })
  pendingDeliveryProofId?: MongooseSchema.Types.ObjectId;

  /**
   * One-shot alerte client « livreur proche » (≤ 500 m).
   * Claim atomique avant push/email pour éviter le spam GPS.
   */
  @Prop({
    required: false,
    name: 'courier_near_customer_notified_at',
    type: Date,
    default: null,
  })
  courierNearCustomerNotifiedAt?: Date | null;

  /**
   * Polyline itinéraire calculée par le livreur (source de vérité cartes admin/client).
   * Format Google Encoded Polyline (précision 5) sauf indication contraire.
   */
  @Prop({ required: false, name: 'courier_route_polyline', maxlength: 100_000 })
  courierRoutePolyline?: string;

  @Prop({
    required: false,
    name: 'courier_route_format',
    enum: ['google'],
    default: 'google',
  })
  courierRouteFormat?: 'google';

  @Prop({
    required: false,
    name: 'courier_route_leg',
    enum: ['to_store', 'to_customer', 'full'],
  })
  courierRouteLeg?: 'to_store' | 'to_customer' | 'full';

  @Prop({ required: false, name: 'courier_route_distance_m' })
  courierRouteDistanceM?: number;

  @Prop({ required: false, name: 'courier_route_duration_s' })
  courierRouteDurationS?: number;

  @Prop({ required: false, name: 'courier_route_updated_at', type: Date })
  courierRouteUpdatedAt?: Date;

  /**
   * Séquence tournée multi-commandes (VROOM) — partagée sur les courses actives
   * du livreur : Pickup A → Pickup B → Deliver A → Deliver B.
   */
  @Prop({
    required: false,
    name: 'courier_tour_stops',
    type: [
      {
        orderId: { type: String },
        kind: { type: String, enum: ['pickup', 'delivery'] },
        longitude: { type: Number },
        latitude: { type: Number },
        sequence: { type: Number },
      },
    ],
  })
  courierTourStops?: Array<{
    orderId: string;
    kind: 'pickup' | 'delivery';
    longitude: number;
    latitude: number;
    sequence: number;
  }>;

  @Prop({ required: false, name: 'courier_tour_updated_at', type: Date })
  courierTourUpdatedAt?: Date;

  @Prop({ required: false, name: 'courier_tour_duration_s' })
  courierTourDurationS?: number;

  /** Offre course flotte boutique en cours (cascade AUTO) — exclusivité claim. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'DeliveryOrderOfferModel',
    required: false,
    name: 'active_delivery_offer_id',
    index: true,
  })
  activeDeliveryOfferId?: MongooseSchema.Types.ObjectId;

  /** Code motif annulation / refus (`out_of_stock`, `changed_mind`, `other`, …). */
  @Prop({
    required: false,
    name: 'cancel_reason_code',
    trim: true,
    maxlength: 64,
  })
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

  /** Adresse de livraison choisie au paiement (référence `addresses`). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'AddressModel',
    name: 'delivery_address',
  })
  deliveryAddress?: MongooseSchema.Types.ObjectId;

  /**
   * Copie figée au paiement (si l’utilisateur modifie ou supprime l’adresse ensuite).
   */
  @Prop({
    name: 'delivery_address_snapshot',
    type: OrderDeliveryAddressSnapshotSchema,
  })
  deliveryAddressSnapshot?: OrderDeliveryAddressSnapshot;

  @Prop({ required: true, name: 'total_price' })
  totalPrice: number;

  /** Sous-total articles (hors livraison et taxes) au paiement. */
  @Prop({ required: false, name: 'subtotal_before_tax', default: 0 })
  subtotalBeforeTax?: number;

  /** Total des taxes régionales appliquées. */
  @Prop({ required: false, name: 'tax_total', default: 0 })
  taxTotal?: number;

  /** Détail des taxes (nom, module, montant). */
  @Prop({
    type: [OrderTaxLineSnapshotSchema],
    default: [],
    name: 'tax_lines',
  })
  taxLines?: OrderTaxLineSnapshot[];

  /** Pays ISO utilisé pour le calcul des taxes (ISO2). */
  @Prop({ required: false, name: 'tax_country_code', trim: true, uppercase: true })
  taxCountryCode?: string;

  /**
   * Région boutique (ISO2) dénormalisée pour file pending livreur / indexes.
   * Remplie à la création et au paiement ; filtre Mongo avant limit.
   */
  @Prop({
    required: false,
    name: 'store_region_code',
    trim: true,
    uppercase: true,
    maxlength: 2,
  })
  storeRegionCode?: string;

  /**
   * Snapshot affiliation : Partner crédité pour cette commande
   * (client / owner boutique / livreur référé).
   */
  @Prop({
    required: false,
    name: 'partner_attribution_user_id',
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    index: true,
  })
  partnerAttributionUserId?: string;

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

  /**
   * Offreur qui a payé une commande cadeau (`user` = destinataire).
   * Absent sur les commandes classiques (payeur = `user`).
   */
  @Prop({
    required: false,
    name: 'paid_by',
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    index: true,
  })
  paidBy?: string;

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

  /** Devise du paiement (ex. `CAD`, `XAF`). Snapshot au moment du paiement Stripe. */
  @Prop({ required: false, name: 'currency', trim: true, uppercase: true })
  currency?: string;

  /** `cs_…` ou `pi_…` du paiement Stripe groupé ayant déclenché la commande. */
  @Prop({ required: false, name: 'stripe_parent_payment_id' })
  stripeParentPaymentId?: string;

  /**
   * Capture Stripe différée (`STRIPE_DEFERRED_CAPTURE`, mono-boutique) :
   * `authorized` → `captured` à la mise en prête, ou `cancelled` si annulation.
   */
  @Prop({
    required: false,
    name: 'stripe_capture_status',
    enum: ['authorized', 'captured', 'cancelled'],
  })
  stripeCaptureStatus?: 'authorized' | 'captured' | 'cancelled';

  @Prop({ required: false, name: 'stripe_captured_at', type: Date })
  stripeCapturedAt?: Date;

  /**
   * Paiement cash au retrait en boutique (pickup / à emporter).
   * Ce n’est pas un paiement à la livraison à domicile.
   */
  @Prop({ default: false, name: 'pay_on_pickup' })
  payOnPickup?: boolean;

  /** Horodatage encaissement cash au retrait (commandes payOnPickup). */
  @Prop({ required: false, name: 'cash_collected_at', type: Date })
  cashCollectedAt?: Date;

  /** Montant cash encaissé en boutique (devise commande). */
  @Prop({ required: false, name: 'cash_collected_amount' })
  cashCollectedAmount?: number;

  /**
   * Écart encaissement vs total dû (devise commande ; négatif = sous-paiement).
   */
  @Prop({ required: false, name: 'cash_collection_variance' })
  cashCollectionVariance?: number;

  /** Code promo boutique appliqué au moment du paiement (si présent). */
  @Prop({ required: false, name: 'coupon_code' })
  couponCode?: string;

  /** Montant de la remise code promo boutique (devise commande). */
  @Prop({ required: false, name: 'coupon_discount_amount' })
  couponDiscountAmount?: number;

  /** Gift code plateforme appliqué au moment du paiement (si présent). */
  @Prop({ required: false, name: 'gift_code' })
  giftCode?: string;

  /** Part de la remise gift code imputée à cette commande (devise commande). */
  @Prop({ required: false, name: 'gift_code_discount_amount' })
  giftCodeDiscountAmount?: number;

  /**
   * Prise en charge gift : STORE (boutique) | PLATFORM (Wise Eat).
   * Absent / autre → STORE (legacy).
   */
  @Prop({ required: false, name: 'gift_code_fee_coverage' })
  giftCodeFeeCoverage?: string;

  /**
   * Goods vendeur pré-gift (centimes Stripe) quand feeCoverage=PLATFORM.
   * Transfer vise ce montant ; charge client reste sur stripeChargedGoodsCents.
   */
  @Prop({ required: false, name: 'stripe_vendor_goods_cents' })
  stripeVendorGoodsCents?: number;

  /** Top-up plateforme (centimes) pour combler gift PLATFORM si fee insuffisante. */
  @Prop({ required: false, name: 'gift_code_platform_top_up_cents' })
  giftCodePlatformTopUpCents?: number;

  /** Transfer top-up gift PLATFORM (`tr_…`), distinct du transfer vendeur principal. */
  @Prop({ required: false, name: 'gift_code_platform_top_up_transfer_id' })
  giftCodePlatformTopUpTransferId?: string;

  /** Horodatage d’envoi du reçu/facture client (idempotence e-mail post-paiement). */
  @Prop({ required: false, name: 'paid_receipt_emailed_at' })
  paidReceiptEmailedAt?: Date;

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

  /** Pourboire livreur (centimes) alloué à cette commande livraison. */
  @Prop({ required: false, name: 'delivery_tip_cents', default: 0 })
  deliveryTipCents?: number;

  /** Frais de transaction plateforme payés par le client (centimes, hors totalPrice). */
  @Prop({ required: false, name: 'order_payment_fee_cents', default: 0 })
  orderPaymentFeeCents?: number;

  @Prop({
    required: false,
    name: 'delivery_tip_status',
    enum: DeliveryTipStatusEnum,
    default: DeliveryTipStatusEnum.NONE,
  })
  deliveryTipStatus?: DeliveryTipStatusEnum;

  @Prop({
    required: false,
    name: 'delivery_tip_allocation_method',
    trim: true,
  })
  deliveryTipAllocationMethod?: string;

  @Prop({ required: false, name: 'stripe_delivery_tip_transfer_id' })
  stripeDeliveryTipTransferId?: string;

  @Prop({ required: false, name: 'stripe_delivery_tip_transfer_amount_cents' })
  stripeDeliveryTipTransferAmountCents?: number;

  @Prop({ required: false, name: 'stripe_delivery_tip_processing_fee_cents' })
  stripeDeliveryTipProcessingFeeCents?: number;

  @Prop({ required: false, name: 'stripe_delivery_tip_transfer_reversal_id' })
  stripeDeliveryTipTransferReversalId?: string;

  @Prop({
    required: false,
    name: 'stripe_delivery_tip_transfer_reversal_amount_cents',
  })
  stripeDeliveryTipTransferReversalAmountCents?: number;

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

  /** Commande planifiée (pré-commande repas). */
  @Prop({ default: false, name: 'is_pre_order' })
  isPreOrder?: boolean;

  /** Date/heure de livraison ou retrait souhaitée (pré-commande). */
  @Prop({ required: false, name: 'scheduled_at', type: Date })
  scheduledAt?: Date;

  /** Rappels push envoyés : `d-3`, `d-2`, `d-1`, `d-day`. */
  @Prop({ type: [String], default: [], name: 'pre_order_reminders_sent' })
  preOrderRemindersSent?: string[];

  /** Rappels vendeur / équipe (push + e-mail) : `d-3`, `d-2`, `d-1`, `d-day`. */
  @Prop({
    type: [String],
    default: [],
    name: 'pre_order_vendor_reminders_sent',
  })
  preOrderVendorRemindersSent?: string[];

  /** Pré-commande remontée dans la file active (jour J). */
  @Prop({ required: false, name: 'pre_order_promoted_at', type: Date })
  preOrderPromotedAt?: Date;

  /** Note client pour le vendeur (pré-commande). */
  @Prop({
    required: false,
    name: 'customer_note',
    trim: true,
    maxlength: 2000,
  })
  customerNote?: string;

  /** Notes admin plateforme → vendeur (historique + notif). */
  @Prop({
    type: [
      {
        note: { type: String, required: true, maxlength: 2000 },
        authorUserId: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
    name: 'admin_notes',
  })
  adminNotes?: Array<{
    note: string;
    authorUserId: string;
    createdAt: Date;
  }>;
}

export const OrderSchema = SchemaFactory.createForClass(OrderModel);

/** Comptage rapide des courses actives par livreur. */
OrderSchema.index({
  assignedDeliveryUser: 1,
  status: 1,
  shouldShip: 1,
});

/** File pending livreur : shouldShip + statut + non assigné + région + récence. */
OrderSchema.index({
  shouldShip: 1,
  status: 1,
  assignedDeliveryUser: 1,
  storeRegionCode: 1,
  createdAt: -1,
});

OrderSchema.index({
  isPreOrder: 1,
  scheduledAt: 1,
  user: 1,
});

/** Filtre « Cadeaux » (commandes offertes par moi). */
OrderSchema.index({
  paidBy: 1,
  createdAt: -1,
});

export type OrderModelDocument = OrderModel & Document;
