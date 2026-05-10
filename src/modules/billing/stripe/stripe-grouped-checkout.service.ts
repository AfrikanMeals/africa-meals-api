import { CartService } from '@modules/cart/cart.service';
import { OrdersService } from '@modules/orders/orders.service';
import { PlatformShippingQuoteService } from '@modules/platform-shipping-settings/platform-shipping-quote.service';
import { StoreService } from '@modules/store/store.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { StripeProcessedCheckoutModel } from '@schemas/stripe-processed-checkout.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import { GroupedStripeCheckoutDto } from './dto/grouped-stripe-checkout.dto';

type StripeClient = InstanceType<typeof Stripe>;

type CartGroup = {
  store: {
    _id?: unknown;
    id?: string;
    name?: string;
    currency?: string;
    supportsShipping?: boolean;
  };
  items: unknown[];
  totalPrice: number;
};

function storeMongoId(store: CartGroup['store']): string {
  const raw = store?.id ?? store?._id;
  if (raw && typeof raw === 'object' && 'toString' in raw) {
    return String((raw as { toString(): string }).toString());
  }
  return String(raw ?? '');
}

@Injectable()
export class StripeGroupedCheckoutService {
  private readonly logger = new Logger(StripeGroupedCheckoutService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cartService: CartService,
    private readonly quoteService: PlatformShippingQuoteService,
    private readonly storeService: StoreService,
    private readonly usersService: UsersService,
    private readonly ordersService: OrdersService,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly processedModel: Model<StripeProcessedCheckoutModel>,
  ) {}

  private stripe() {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new BadRequestException(
        'Paiement indisponible : ajoutez STRIPE_SECRET_KEY dans le .env de l’API (africa-meals-api), puis redémarrez le serveur.',
      );
    }
    return new Stripe(key);
  }

  async createGroupedCheckoutSession(
    user: UserModel,
    dto: GroupedStripeCheckoutDto,
  ): Promise<{ url: string }> {
    const coupons = (dto.coupons ?? [])
      .filter((c) => c.code?.trim())
      .map((c) => ({
        storeId: c.storeId.trim(),
        code: c.code.trim(),
      }));

    const validation = await this.cartService.validateCheckoutReadiness(user, {
      coupons,
    });
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'checkout_validation_failed',
        ...validation,
      });
    }

    const cart = await this.cartService.filter(user);
    const groups = (cart?.data ?? []) as CartGroup[];
    if (!groups.length) {
      throw new BadRequestException('cart_is_empty');
    }

    const currencies = new Set(
      groups.map((g) => String(g.store?.currency ?? 'cad').toLowerCase()),
    );
    if (currencies.size !== 1) {
      throw new BadRequestException('multi_currency_not_supported');
    }
    const currency = [...currencies][0];

    const fulfillment = dto.fulfillmentByStoreId ?? {};
    const needsAddress = groups.some((g) => {
      const id = storeMongoId(g.store);
      const mode = fulfillment[id] ?? 'pickup';
      return mode === 'delivery' && g.store?.supportsShipping === true;
    });
    if (needsAddress && !dto.addressId?.trim()) {
      throw new BadRequestException('address_required_for_delivery');
    }

    const lineItems: NonNullable<
      Parameters<StripeClient['checkout']['sessions']['create']>[0]['line_items']
    > = [];
    const shipCentsByStore: Record<string, number> = {};
    const couponByStore = new Map(
      coupons.map((c) => [c.storeId, c.code] as const),
    );

    for (const g of groups) {
      const storeId = storeMongoId(g.store);
      if (!storeId) continue;

      const mode = fulfillment[storeId] ?? 'pickup';
      if (mode !== 'delivery' && mode !== 'pickup') {
        throw new BadRequestException('invalid_fulfillment_mode');
      }

      let goods = Number(g.totalPrice) || 0;
      const code = couponByStore.get(storeId);
      if (code) {
        const snap = await this.cartService.previewCouponForStore(
          user,
          storeId,
          code,
        );
        goods = snap.totalAfterDiscount;
      }

      let shipFee = 0;
      if (
        mode === 'delivery' &&
        g.store?.supportsShipping &&
        dto.addressId
      ) {
        const q = await this.quoteService.quoteForUser(user, {
          storeId,
          addressId: dto.addressId,
        });
        if (!q.deliverable || q.fee == null) {
          throw new BadRequestException({
            message: 'delivery_not_available',
            storeId,
            distanceKm: q.distanceKm,
            maxDeliveryRadiusKm: q.maxDeliveryRadiusKm,
          });
        }
        shipFee = q.fee;
      }
      shipCentsByStore[storeId] = Math.round(shipFee * 100 + Number.EPSILON);

      const goodsCents = Math.round(goods * 100 + Number.EPSILON);
      const totalCents = goodsCents + shipCentsByStore[storeId];
      if (totalCents < 50) {
        throw new BadRequestException({
          message: 'amount_below_stripe_minimum',
          storeId,
          totalCents,
        });
      }

      const storeName = String(g.store?.name ?? 'Restaurant');
      const modeFr = mode === 'delivery' ? 'livraison' : 'retrait';

      lineItems.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: totalCents,
          product_data: {
            name: `Afrika Meals — ${storeName} (${modeFr})`,
            description:
              mode === 'delivery'
                ? `Panier + frais de livraison estimés (${storeName})`
                : `Panier — retrait sur place (${storeName})`,
          },
        },
      });
    }

    if (!lineItems.length) {
      throw new BadRequestException('cart_is_empty');
    }

    // Deuxième passage (stocks + promos) juste avant Stripe : le panier peut
    // avoir changé pendant les appels preview / devis livraison.
    const recheck = await this.cartService.validateCheckoutReadiness(user, {
      coupons,
    });
    if (!recheck.ok) {
      throw new BadRequestException({
        message: 'checkout_validation_failed',
        ...recheck,
      });
    }

    const server =
      this.config.get<string>('SERVER_URL')?.replace(/\/$/, '') ??
      'http://localhost:9000';
    const rawSuccess =
      this.config.get<string>('STRIPE_CHECKOUT_SUCCESS_URL') ??
      `${server}/api/billing/stripe/payment-done`;
    const rawCancel =
      this.config.get<string>('STRIPE_CHECKOUT_CANCEL_URL') ??
      `${server}/api/billing/stripe/payment-cancel`;

    const successUrl = rawSuccess.includes('{CHECKOUT_SESSION_ID}')
      ? rawSuccess
      : `${rawSuccess}${rawSuccess.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = rawCancel;

    const shipB64 = Buffer.from(JSON.stringify(shipCentsByStore), 'utf8').toString(
      'base64url',
    );
    const stripe = this.stripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: String(user.id),
      customer_email: user.email,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        uid: String(user.id),
        stores: groups.map((g) => storeMongoId(g.store)).filter(Boolean).join(','),
        shipB64,
      },
    });

    const url = session.url;
    if (!url) {
      throw new BadRequestException('stripe_missing_checkout_url');
    }
    return { url };
  }

  async handleWebhook(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<{ received: boolean }> {
    const whSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!whSecret || !signature || !rawBody?.length) {
      this.logger.warn('Stripe webhook: missing secret, signature or body');
      return { received: false };
    }
    const stripe = this.stripe();
    let event: ReturnType<StripeClient['webhooks']['constructEvent']>;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, whSecret);
    } catch (err) {
      this.logger.warn(`Stripe webhook signature: ${err}`);
      throw new BadRequestException('stripe_invalid_signature');
    }

    if (event.type !== 'checkout.session.completed') {
      return { received: true };
    }

    const session = event.data.object as {
      id: string;
      metadata?: Record<string, string | undefined>;
    };
    const uid = session.metadata?.uid;
    const storesCsv = session.metadata?.stores;
    const shipB64 = session.metadata?.shipB64;
    if (!uid || !storesCsv) {
      this.logger.warn('Stripe webhook: missing metadata');
      return { received: true };
    }

    let shipCentsByStore: Record<string, number> = {};
    if (shipB64) {
      try {
        shipCentsByStore = JSON.parse(
          Buffer.from(shipB64, 'base64url').toString('utf8'),
        ) as Record<string, number>;
      } catch {
        shipCentsByStore = {};
      }
    }

    try {
      await this.processedModel.create({
        sessionId: session.id,
        userId: new Types.ObjectId(uid),
        orderIds: [],
      });
    } catch (e: unknown) {
      const code = (e as { code?: number })?.code;
      if (code === 11000) {
        this.logger.log(`Stripe webhook: duplicate session ${session.id}`);
        return { received: true };
      }
      throw e;
    }

    const userDoc = await this.usersService.findById(uid);
    if (!userDoc) {
      this.logger.error(`Stripe webhook: user not found ${uid}`);
      return { received: true };
    }
    const user = userDoc as unknown as UserModel;

    const storeIds = storesCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const orderIds: string[] = [];

    for (const storeId of storeIds) {
      try {
        const order = await this.storeService.createOrderFromCart(
          storeId,
          user,
        );
        const oid =
          (order as { _id?: Types.ObjectId })?._id?.toString() ??
          (order as { id?: string })?.id;
        if (oid) {
          orderIds.push(oid);
          const shipCents = shipCentsByStore[storeId] ?? 0;
          const ship = shipCents / 100;
          await this.ordersService.markOrderPaidWithShipping(oid, ship);
        }
      } catch (e) {
        this.logger.error(
          `Stripe webhook: order failed for store ${storeId}: ${e}`,
        );
      }
    }

    await this.processedModel.updateOne(
      { sessionId: session.id },
      { $set: { orderIds } },
    );

    return { received: true };
  }
}
