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
}

export const OrderSchema = SchemaFactory.createForClass(OrderModel);

export type OrderModelDocument = OrderModel & Document;
