import { CartService } from '@modules/cart/cart.service';
import { CouponsService } from '@modules/coupons/coupons.service';
import { OrdersService } from '@modules/orders/orders.service';
import { PlatformShippingQuoteService } from '@modules/platform-shipping-settings/platform-shipping-quote.service';
import { StoreService } from '@modules/store/store.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  StripePerStoreBreakdownRow,
  StripeProcessedCheckoutModel,
} from '@schemas/stripe-processed-checkout.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import { FilterGroupedPaymentsDto } from './dto/filter-grouped-payments.dto';
import { GroupedStripeCheckoutDto } from './dto/grouped-stripe-checkout.dto';

type StripeClient = InstanceType<typeof Stripe>;

type StripeFulfillResult = {
  complete: boolean;
  orderIds: string[];
  errors: Array<{ storeId: string; error: string }>;
};

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

type CheckoutLineItem = NonNullable<
  Parameters<StripeClient['checkout']['sessions']['create']>[0]['line_items']
>[number];

type GroupedStripeBuilt = {
  currency: string;
  lineItems: CheckoutLineItem[];
  shipCentsByStore: Record<string, number>;
  /** Montants agrégés par boutique (goods + ship) pour suivi / remboursements partiels côté Dashboard. */
  payoutByStore: Record<
    string,
    { storeName: string; goodsCents: number; shipCents: number }
  >;
  groups: CartGroup[];
  coupons: Array<{ storeId: string; code: string }>;
};

function storeMongoId(store: CartGroup['store']): string {
  const raw = store?.id ?? store?._id;
  if (raw && typeof raw === 'object' && 'toString' in raw) {
    return String((raw as { toString(): string }).toString());
  }
  return String(raw ?? '');
}

/** Libellé lisible pour une ligne panier (Checkout Stripe). */
function stripeLabelForCartLine(line: Record<string, unknown>): string {
  const ent = line['entity'] as Record<string, unknown> | undefined;
  const raw =
    ent != null ? (ent['title'] ?? ent['name'] ?? ent['label']) : null;
  const t = raw != null ? String(raw).trim() : '';
  if (t) return t.slice(0, 120);
  const typ = String(line['type'] ?? '');
  if (typ === 'drink') return 'Boisson';
  if (typ === 'product') return 'Produit';
  if (typ === 'offer') return 'Offre';
  if (typ === 'product_extra') return 'Option';
  return 'Article';
}

function cartLineQuantity(line: Record<string, unknown>): number {
  return Math.max(1, Math.floor(Number(line['quantity'] ?? 1)));
}

function cartLineUnitCents(line: Record<string, unknown>): number {
  const price = Number(line['price'] ?? 0);
  return Math.max(0, Math.round(price * 100 + Number.EPSILON));
}

/** Stripe Checkout : miniatures uniquement si URL HTTPS absolue. */
function stripeHttpsProductImages(
  line: Record<string, unknown>,
  maxImages: number,
): string[] | undefined {
  const ent = line['entity'] as Record<string, unknown> | undefined;
  if (!ent || maxImages < 1) return undefined;
  const out: string[] = [];
  const push = (u: unknown) => {
    if (typeof u !== 'string') return;
    const s = u.trim();
    if (s.startsWith('https://') && out.length < maxImages) {
      out.push(s);
    }
  };
  push(ent['profileImage']);
  push(ent['imageUrl']);
  const imgs = ent['images'];
  if (Array.isArray(imgs)) {
    for (const im of imgs) {
      if (typeof im === 'string') push(im);
      else if (im && typeof im === 'object' && 'url' in im) {
        push((im as { url?: unknown }).url);
      }
    }
  }
  return out.length ? out.slice(0, maxImages) : undefined;
}

/**
 * Répartit `target` centimes sur les lignes proportionnellement à `weights`,
 * sans dépasser chaque poids (cas remise : target ≤ somme des weights).
 */
function distributeCentsByWeights(weights: number[], target: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map(() => 0);
  const n = weights.length;
  const base = weights.map((w) =>
    Math.floor((w / sum) * target + Number.EPSILON),
  );
  let diff = target - base.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (diff > 0 && guard < 100000) {
    let best = -1;
    let bestIdx = 0;
    for (let i = 0; i < n; i++) {
      const headroom = weights[i] - base[i];
      if (headroom > best) {
        best = headroom;
        bestIdx = i;
      }
    }
    if (best <= 0) {
      base[n - 1] += diff;
      break;
    }
    base[bestIdx]++;
    diff--;
    guard++;
  }
  guard = 0;
  while (diff < 0 && guard < 100000) {
    let bestIdx = 0;
    let bestVal = -1;
    for (let i = 0; i < n; i++) {
      if (base[i] > bestVal) {
        bestVal = base[i];
        bestIdx = i;
      }
    }
    if (bestVal <= 0) break;
    base[bestIdx]--;
    diff++;
    guard++;
  }
  return base;
}

/** Métadonnées produit Checkout (valeurs string courtes, clés ≤ 40 car. côté Stripe). */
function stripeProductMetadata(params: {
  storeId: string;
  storeName: string;
  lineKind: 'goods' | 'shipping' | 'promo_goods';
  line: Record<string, unknown>;
}): Record<string, string> {
  const { storeId, storeName, lineKind, line } = params;
  const ent = line['entity'] as Record<string, unknown> | undefined;
  const fromEntity =
    ent != null && ent['_id'] != null ? String(ent['_id']).trim() : '';
  const entityId = (
    fromEntity ||
    String(line['entityId'] ?? line['entity_id'] ?? '').trim()
  ).slice(0, 80);
  const typ = String(line['type'] ?? '').trim().slice(0, 40);
  const cartLineId = String(line['_id'] ?? line['id'] ?? '').trim().slice(0, 32);
  const meta: Record<string, string> = {
    afrika_store_id: storeId.slice(0, 60),
    afrika_store_name: storeName.slice(0, 120),
    afrika_line_kind: lineKind,
    afrika_item_type: typ || 'unknown',
  };
  if (entityId) meta['afrika_entity_id'] = entityId;
  if (cartLineId) meta['afrika_cart_line_id'] = cartLineId;
  return meta;
}

function checkoutLineFromCartRow(params: {
  currency: string;
  storeId: string;
  storeName: string;
  mode: 'delivery' | 'pickup';
  line: Record<string, unknown>;
  quantity: number;
  unitAmountCents: number;
  lineKind: 'goods' | 'shipping' | 'promo_goods';
  extraDescription?: string;
}): CheckoutLineItem | null {
  const {
    currency,
    storeId,
    storeName,
    mode,
    line,
    quantity,
    unitAmountCents,
    lineKind,
    extraDescription,
  } = params;
  if (quantity < 1 || unitAmountCents < 1) return null;
  const parts = [
    extraDescription,
    mode === 'delivery' ? 'Livraison estimée' : 'Retrait',
    storeName,
  ].filter((x) => x && String(x).trim());
  const desc = parts.join(' · ').slice(0, 500);
  const images = stripeHttpsProductImages(line, 8);
  const label = stripeLabelForCartLine(line);
  return {
    quantity,
    price_data: {
      currency,
      unit_amount: unitAmountCents,
      product_data: {
        name: `${storeName} · ${label}`.slice(0, 250),
        description: desc || undefined,
        metadata: stripeProductMetadata({ storeId, storeName, lineKind, line }),
        ...(images?.length ? { images } : {}),
      },
    },
  };
}

/** Montants par boutique issus des métadonnées Stripe (`payout_v1`). */
function parsePayoutFromStripeMetadata(
  meta: Record<string, string | undefined | null>,
): Map<string, { goodsCents: number; shipCents: number }> {
  const m = new Map<string, { goodsCents: number; shipCents: number }>();
  let raw = meta['payout_v1']?.trim();
  if (!raw) {
    const b64 = meta['payout_v1_b64']?.trim();
    if (b64) {
      try {
        raw = Buffer.from(b64, 'base64url').toString('utf8');
      } catch {
        raw = '';
      }
    }
  }
  if (!raw) return m;
  try {
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr)) return m;
    for (const row of arr) {
      if (Array.isArray(row) && row.length >= 3) {
        const id = String(row[0] ?? '').trim();
        if (!id) continue;
        const g = Math.max(0, Math.round(Number(row[1] ?? 0)));
        const s = Math.max(0, Math.round(Number(row[2] ?? 0)));
        m.set(id, { goodsCents: g, shipCents: s });
        continue;
      }
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const o = row as Record<string, unknown>;
        const id = String(o['i'] ?? '').trim();
        if (!id) continue;
        const g = Math.max(0, Math.round(Number(o['g'] ?? 0)));
        const s = Math.max(0, Math.round(Number(o['s'] ?? 0)));
        m.set(id, { goodsCents: g, shipCents: s });
      }
    }
  } catch {
    /* ignore */
  }
  return m;
}

/** Codes promo par boutique (`coupons_v1` sur la session / le PaymentIntent). */
function parseCouponsFromStripeMetadata(
  meta: Record<string, string | undefined | null>,
): Map<string, string> {
  const m = new Map<string, string>();
  const raw = meta['coupons_v1']?.trim();
  if (!raw) return m;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return m;
    for (const row of arr) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const o = row as { i?: unknown; c?: unknown };
        const id = String(o.i ?? '').trim();
        const code = String(o.c ?? '').trim();
        if (id && code) m.set(id, code);
      }
    }
  } catch {
    /* ignore */
  }
  return m;
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
    private readonly couponsService: CouponsService,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly processedModel: Model<StripeProcessedCheckoutModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
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

  /**
   * Panier groupé → lignes Checkout + frais (même logique que PaymentIntent).
   */
  private async buildGroupedStripePayload(
    user: UserModel,
    dto: GroupedStripeCheckoutDto,
  ): Promise<GroupedStripeBuilt> {
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

    const lineItems: CheckoutLineItem[] = [];
    const shipCentsByStore: Record<string, number> = {};
    const payoutByStore: GroupedStripeBuilt['payoutByStore'] = {};
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

      const storeName = String(g.store?.name ?? 'Restaurant');
      payoutByStore[storeId] = {
        storeName,
        goodsCents: 0,
        shipCents: shipCentsByStore[storeId] ?? 0,
      };
      const rawItems = Array.isArray(g.items) ? g.items : [];
      const cartLines = rawItems.filter(
        (x): x is Record<string, unknown> =>
          x != null && typeof x === 'object' && !Array.isArray(x),
      );

      const code = couponByStore.get(storeId);
      if (code) {
        const snap = await this.cartService.previewCouponForStore(
          user,
          storeId,
          code,
        );
        const targetGoodsCents = Math.round(
          snap.totalAfterDiscount * 100 + Number.EPSILON,
        );
        const shipC = shipCentsByStore[storeId] ?? 0;
        const totalCents = targetGoodsCents + shipC;
        if (totalCents < 50) {
          throw new BadRequestException({
            message: 'amount_below_stripe_minimum',
            storeId,
            totalCents,
          });
        }
        const grossPerLine = cartLines.map(
          (line) => cartLineUnitCents(line) * cartLineQuantity(line),
        );
        const sumGross = grossPerLine.reduce((a, b) => a + b, 0);
        if (cartLines.length && sumGross > 0) {
          const capTarget = Math.min(targetGoodsCents, sumGross);
          const allocated = distributeCentsByWeights(grossPerLine, capTarget);
          for (let i = 0; i < cartLines.length; i++) {
            const cents = allocated[i] ?? 0;
            if (cents < 1) continue;
            const line = cartLines[i];
            const qtyOrig = cartLineQuantity(line);
            const li = checkoutLineFromCartRow({
              currency,
              storeId,
              storeName,
              mode,
              line,
              quantity: 1,
              unitAmountCents: cents,
              lineKind: 'promo_goods',
              extraDescription:
                qtyOrig > 1
                  ? `Qté ${qtyOrig} · prix avec remise`
                  : 'Prix avec remise',
            });
            if (li) {
              lineItems.push(li);
              payoutByStore[storeId].goodsCents += cents;
            }
          }
        } else {
          const goodsC = Math.max(1, targetGoodsCents);
          const li = checkoutLineFromCartRow({
            currency,
            storeId,
            storeName,
            mode,
            line: { entity: { title: `Panier — ${storeName}` } },
            quantity: 1,
            unitAmountCents: goodsC,
            lineKind: 'promo_goods',
            extraDescription: 'Panier (code promo)',
          });
          if (li) {
            lineItems.push(li);
            payoutByStore[storeId].goodsCents += goodsC;
          }
        }
        if (
          mode === 'delivery' &&
          g.store?.supportsShipping &&
          dto.addressId &&
          shipC > 0
        ) {
          const shipLi = checkoutLineFromCartRow({
            currency,
            storeId,
            storeName,
            mode,
            line: {
              type: 'shipping_fee',
              entity: { title: `Frais de livraison — ${storeName}` },
            },
            quantity: 1,
            unitAmountCents: shipC,
            lineKind: 'shipping',
            extraDescription: 'Livraison estimée',
          });
          if (shipLi) lineItems.push(shipLi);
        }
        continue;
      }

      // Sans code promo : une ligne Checkout par article (alignée sur le panier).
      for (const line of cartLines) {
        const qty = cartLineQuantity(line);
        const ua = cartLineUnitCents(line);
        if (ua * qty < 1) continue;
        const li = checkoutLineFromCartRow({
          currency,
          storeId,
          storeName,
          mode,
          line,
          quantity: qty,
          unitAmountCents: ua,
          lineKind: 'goods',
        });
        if (li) {
          lineItems.push(li);
          payoutByStore[storeId].goodsCents += ua * qty;
        }
      }
      if (
        mode === 'delivery' &&
        g.store?.supportsShipping &&
        dto.addressId &&
        shipCentsByStore[storeId] > 0
      ) {
        const shipLi = checkoutLineFromCartRow({
          currency,
          storeId,
          storeName,
          mode,
          line: {
            type: 'shipping_fee',
            entity: { title: `Frais de livraison — ${storeName}` },
          },
          quantity: 1,
          unitAmountCents: shipCentsByStore[storeId],
          lineKind: 'shipping',
          extraDescription: 'Livraison estimée',
        });
        if (shipLi) lineItems.push(shipLi);
      }

      let bundleCents = 0;
      for (const line of cartLines) {
        bundleCents += cartLineUnitCents(line) * cartLineQuantity(line);
      }
      bundleCents += shipCentsByStore[storeId] ?? 0;
      if (bundleCents < 50) {
        throw new BadRequestException({
          message: 'amount_below_stripe_minimum',
          storeId,
          totalCents: bundleCents,
        });
      }
    }

    if (!lineItems.length) {
      throw new BadRequestException('cart_is_empty');
    }

    if (lineItems.length > 100) {
      throw new BadRequestException({
        message: 'stripe_checkout_line_item_limit',
        count: lineItems.length,
        limit: 100,
      });
    }

    return {
      currency,
      lineItems,
      shipCentsByStore,
      payoutByStore,
      groups,
      coupons,
    };
  }

  /**
   * Récap par boutique pour metadata Stripe (max 500 car. par valeur, 50 clés max).
   */
  private payoutMetadataChunks(
    payoutByStore: GroupedStripeBuilt['payoutByStore'],
  ): Record<string, string> {
    type Row = { i: string; n: string; g: number; s: number };
    const rows: Row[] = Object.entries(payoutByStore).map(([id, v]) => ({
      i: id,
      n: v.storeName.slice(0, 48),
      g: v.goodsCents,
      s: v.shipCents,
    }));
    let json = JSON.stringify(rows);
    if (json.length <= 490) return { payout_v1: json };
    const slim: Array<[string, number, number]> = Object.entries(
      payoutByStore,
    ).map(([id, v]) => [id, v.goodsCents, v.shipCents]);
    json = JSON.stringify(slim);
    if (json.length <= 490) return { payout_v1: json };
    const b64 = Buffer.from(json, 'utf8').toString('base64url');
    if (b64.length <= 490) return { payout_v1_b64: b64 };
    const out: Record<string, string> = {};
    const chunkSize = 480;
    let part = 0;
    for (let i = 0; i < b64.length && part < 35; i += chunkSize, part++) {
      out[`payout_b64_${part}`] = b64.slice(i, i + chunkSize);
    }
    out['payout_b64_parts'] = String(part);
    return out;
  }

  /** Codes promo appliqués au paiement (webhook → incrément `usedCount`). */
  private couponsMetadataChunk(
    coupons: GroupedStripeBuilt['coupons'],
  ): Record<string, string> {
    if (!coupons?.length) return {};
    const rows = coupons.map((c) => ({
      i: c.storeId,
      c: c.code.trim().toUpperCase(),
    }));
    const json = JSON.stringify(rows);
    if (json.length <= 490) return { coupons_v1: json };
    this.logger.warn(
      `Stripe grouped checkout: coupons_v1 metadata too long (${json.length}), omitted`,
    );
    return {};
  }

  private groupedMetadata(
    user: UserModel,
    built: GroupedStripeBuilt,
  ): Record<string, string> {
    const shipB64 = Buffer.from(
      JSON.stringify(built.shipCentsByStore),
      'utf8',
    ).toString('base64url');
    const base: Record<string, string> = {
      uid: String(user.id),
      stores: built.groups
        .map((g) => storeMongoId(g.store))
        .filter(Boolean)
        .join(','),
      shipB64,
    };
    return {
      ...base,
      ...this.payoutMetadataChunks(built.payoutByStore),
      ...this.couponsMetadataChunk(built.coupons),
    };
  }

  private async recheckBeforeStripe(
    user: UserModel,
    coupons: GroupedStripeBuilt['coupons'],
  ): Promise<void> {
    const recheck = await this.cartService.validateCheckoutReadiness(user, {
      coupons,
    });
    if (!recheck.ok) {
      throw new BadRequestException({
        message: 'checkout_validation_failed',
        ...recheck,
      });
    }
  }

  async createGroupedCheckoutSession(
    user: UserModel,
    dto: GroupedStripeCheckoutDto,
  ): Promise<{ url: string }> {
    const built = await this.buildGroupedStripePayload(user, dto);
    await this.recheckBeforeStripe(user, built.coupons);

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

    const meta = this.groupedMetadata(user, built);
    const nStores = Object.keys(built.payoutByStore).length;
    const piDescription =
      nStores > 1
        ? `Afrika Meals · ${nStores} restaurants`
        : `Afrika Meals · ${nStores} restaurant`;
    const stripe = this.stripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: String(user.id),
      customer_email: user.email,
      line_items: built.lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: meta,
      payment_intent_data: {
        description: piDescription,
        metadata: meta,
      },
    });

    const url = session.url;
    if (!url) {
      throw new BadRequestException('stripe_missing_checkout_url');
    }
    return { url };
  }

  /**
   * Un seul PaymentIntent (montant = somme des lignes panier groupé) pour
   * PaymentSheet côté app : Apple Pay, Google Pay, cartes.
   */
  async createGroupedPaymentIntent(
    user: UserModel,
    dto: GroupedStripeCheckoutDto,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const built = await this.buildGroupedStripePayload(user, dto);
    await this.recheckBeforeStripe(user, built.coupons);

    const totalCents = built.lineItems.reduce((sum, li) => {
      const ua = li.price_data?.unit_amount;
      if (ua == null) return sum;
      const q = li.quantity ?? 1;
      return sum + ua * q;
    }, 0);

    if (totalCents < 50) {
      throw new BadRequestException({
        message: 'amount_below_stripe_minimum',
        totalCents,
      });
    }

    const meta = this.groupedMetadata(user, built);
    const nStores = Object.keys(built.payoutByStore).length;
    const piDescription =
      nStores > 1
        ? `Afrika Meals · ${nStores} restaurants`
        : `Afrika Meals · ${nStores} restaurant`;
    const stripe = this.stripe();
    const pi = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: built.currency,
      automatic_payment_methods: { enabled: true },
      metadata: meta,
      receipt_email: user.email || undefined,
      description: piDescription,
    });

    if (!pi.client_secret) {
      throw new BadRequestException('stripe_missing_payment_intent_secret');
    }

    return {
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
    };
  }

  private async isStripeFulfillmentComplete(
    doc: {
      orderIds?: string[];
      perStoreBreakdown?: StripePerStoreBreakdownRow[];
    } | null,
    storeIds: string[],
    stripePaymentId: string,
  ): Promise<boolean> {
    if (!doc || !storeIds.length) {
      return false;
    }
    const rows = doc.perStoreBreakdown ?? [];
    for (const sid of storeIds) {
      const row = rows.find((r) => r.storeId === sid);
      if (!row?.orderId || row.error) {
        return false;
      }
      const paid = await this.ordersService.isOrderPaidForStripePayment(
        row.orderId,
        stripePaymentId,
      );
      if (!paid) {
        return false;
      }
    }
    return (doc.orderIds?.length ?? 0) > 0;
  }

  private isCartEmptyFulfillError(e: unknown): boolean {
    if (e instanceof NotFoundException) {
      return e.message === 'cart_is_empty';
    }
    if (e instanceof BadRequestException) {
      const r = e.getResponse();
      if (typeof r === 'string') {
        return r === 'cart_is_empty';
      }
      if (r && typeof r === 'object' && 'message' in r) {
        const m = (r as { message?: unknown }).message;
        return m === 'cart_is_empty' || (Array.isArray(m) && m.includes('cart_is_empty'));
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('cart_is_empty');
  }

  private async fulfillOrdersAfterStripePayment(params: {
    stripePaymentId: string;
    uid: string;
    storesCsv: string;
    shipB64?: string;
    metadata: Record<string, string | undefined | null>;
    amountTotalCents?: number;
    currency?: string;
    stripeEventKind: 'checkout_session' | 'payment_intent';
  }): Promise<StripeFulfillResult> {
    const {
      stripePaymentId,
      uid,
      storesCsv,
      shipB64,
      metadata,
      amountTotalCents,
      currency,
      stripeEventKind,
    } = params;

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

    const payoutMap = parsePayoutFromStripeMetadata(metadata);
    const couponByStore = parseCouponsFromStripeMetadata(metadata);

    const storeIds = storesCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let processed = await this.processedModel
      .findOne({ sessionId: stripePaymentId })
      .lean()
      .exec();

    if (
      processed &&
      (await this.isStripeFulfillmentComplete(
        processed,
        storeIds,
        stripePaymentId,
      ))
    ) {
      this.logger.log(
        `Stripe fulfill: already complete for ${stripePaymentId}`,
      );
      return {
        complete: true,
        orderIds: processed.orderIds ?? [],
        errors: [],
      };
    }

    if (!processed) {
      try {
        await this.processedModel.create({
          sessionId: stripePaymentId,
          userId: new Types.ObjectId(uid),
          orderIds: [],
          amountTotalCents,
          currency: currency?.toLowerCase(),
          stripeEventKind,
        });
      } catch (e: unknown) {
        const code = (e as { code?: number })?.code;
        if (code === 11000) {
          processed = await this.processedModel
            .findOne({ sessionId: stripePaymentId })
            .lean()
            .exec();
          if (
            processed &&
            (await this.isStripeFulfillmentComplete(
              processed,
              storeIds,
              stripePaymentId,
            ))
          ) {
            return {
              complete: true,
              orderIds: processed.orderIds ?? [],
              errors: [],
            };
          }
          this.logger.warn(
            `Stripe fulfill: retry after concurrent insert ${stripePaymentId}`,
          );
        } else {
          throw e;
        }
      }
    } else {
      this.logger.warn(
        `Stripe fulfill: retry after partial failure ${stripePaymentId}`,
      );
    }

    const priorByStore = new Map<string, StripePerStoreBreakdownRow>();
    for (const row of processed?.perStoreBreakdown ?? []) {
      if (row?.storeId) {
        priorByStore.set(row.storeId, row);
      }
    }

    const userDoc = await this.usersService.findById(uid);
    if (!userDoc) {
      this.logger.error(`Stripe fulfill: user not found ${uid}`);
      return {
        complete: false,
        orderIds: [],
        errors: [{ storeId: '*', error: 'user_not_found' }],
      };
    }
    const user = userDoc as unknown as UserModel;

    const orderIds: string[] = [...(processed?.orderIds ?? [])];
    const perStoreBreakdown: StripePerStoreBreakdownRow[] = [];
    const fulfillErrors: Array<{ storeId: string; error: string }> = [];

    for (const storeId of storeIds) {
      const prior = priorByStore.get(storeId);
      if (prior?.orderId && !prior.error) {
        const alreadyPaid = await this.ordersService.isOrderPaidForStripePayment(
          prior.orderId,
          stripePaymentId,
        );
        if (alreadyPaid) {
          perStoreBreakdown.push(prior);
          if (!orderIds.includes(prior.orderId)) {
            orderIds.push(prior.orderId);
          }
          continue;
        }
      }

      const payoutRow = payoutMap.get(storeId);
      const shipCents =
        payoutRow != null
          ? Math.max(0, payoutRow.shipCents)
          : Math.max(0, Math.round(shipCentsByStore[storeId] ?? 0));
      const goodsCents =
        payoutRow != null ? Math.max(0, payoutRow.goodsCents) : undefined;
      const couponCode = couponByStore.get(storeId);

      const baseRow: StripePerStoreBreakdownRow = {
        storeId,
        goodsCents: goodsCents ?? 0,
        shipCents,
        couponCode,
      };

      try {
        let oid =
          await this.ordersService.findRecoverableOrderIdForStorePayment(
            uid,
            storeId,
            stripePaymentId,
          );

        if (!oid) {
          try {
            const order = await this.storeService.createOrderFromCart(
              storeId,
              user,
            );
            oid =
              (order as { _id?: Types.ObjectId })?._id?.toString() ??
              (order as { id?: string })?.id ??
              null;
          } catch (createErr) {
            if (this.isCartEmptyFulfillError(createErr)) {
              oid =
                await this.ordersService.findRecoverableOrderIdForStorePayment(
                  uid,
                  storeId,
                  stripePaymentId,
                );
            }
            if (!oid) {
              throw createErr;
            }
          }
        }

        if (!oid) {
          throw new Error('order_id_missing_after_create');
        }

        if (!orderIds.includes(oid)) {
          orderIds.push(oid);
        }
        const useStripeCents = payoutRow != null;
        await this.ordersService.markOrderPaidWithShipping(
          oid,
          shipCents / 100,
          {
            stripeParentPaymentId: stripePaymentId,
            couponCode,
            chargedGoodsCents: useStripeCents ? goodsCents : undefined,
            chargedShipCents: useStripeCents ? shipCents : undefined,
          },
        );
        const paidOk = await this.ordersService.isOrderPaidForStripePayment(
          oid,
          stripePaymentId,
        );
        if (!paidOk) {
          throw new Error('order_not_marked_paid');
        }
        if (couponCode) {
          await this.couponsService.recordUsageAfterSuccessfulPayment(
            storeId,
            couponCode,
          );
        }
        perStoreBreakdown.push({
          ...baseRow,
          orderId: oid,
          goodsCents: goodsCents ?? baseRow.goodsCents,
          shipCents,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `Stripe fulfill: order failed for store ${storeId}: ${e}`,
        );
        fulfillErrors.push({ storeId, error: errMsg });
        perStoreBreakdown.push({
          ...baseRow,
          error: errMsg,
        });
      }
    }

    await this.processedModel.updateOne(
      { sessionId: stripePaymentId },
      {
        $set: {
          orderIds,
          perStoreBreakdown,
          amountTotalCents,
          currency: currency?.toLowerCase(),
          stripeEventKind,
        },
      },
      { upsert: true },
    );

    const complete =
      storeIds.length > 0 &&
      storeIds.every((sid) => {
        const row = perStoreBreakdown.find((r) => r.storeId === sid);
        return Boolean(row?.orderId && !row.error);
      });

    if (!complete) {
      this.logger.warn(
        `Stripe fulfill: incomplete for ${stripePaymentId}: ${fulfillErrors
          .map((x) => `${x.storeId}=${x.error}`)
          .join('; ')}`,
      );
    }

    return { complete, orderIds, errors: fulfillErrors };
  }

  /**
   * Liste des paiements groupés réussis (`stripe_processed_checkouts`) pour le client JWT.
   */
  async listMyGroupedPayments(
    user: UserModel,
    args: FilterGroupedPaymentsDto,
  ): Promise<{ data: Record<string, unknown>[] }> {
    const lim =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(200, Math.max(1, args.limit))
        : 20;

    const skip =
      typeof args.skip === 'number' && args.skip > 0
        ? Math.min(10_000, Math.max(0, Math.floor(args.skip)))
        : 0;

    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(String(user.id)),
    };

    if (args.stripeEventKind) {
      filter['stripeEventKind'] = args.stripeEventKind;
    }

    const qRaw = args.q?.trim();
    if (qRaw) {
      const esc = qRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(esc, 'i');
      const matching = await this.storeModel
        .find({ name: rx })
        .select('_id')
        .limit(500)
        .lean()
        .exec();
      const matchIds = matching.map((s) => String(s._id));
      const ors: Record<string, unknown>[] = [{ sessionId: rx }];
      if (matchIds.length) {
        ors.push({ 'perStoreBreakdown.storeId': { $in: matchIds } });
      }
      filter['$or'] = ors;
    }

    const docs = await this.processedModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .lean()
      .exec();

    const storeIdSet = new Set<string>();
    for (const d of docs) {
      const rows = d.perStoreBreakdown as StripePerStoreBreakdownRow[] | undefined;
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const sid = String(r.storeId ?? '').trim();
        if (sid && Types.ObjectId.isValid(sid)) {
          storeIdSet.add(sid);
        }
      }
    }

    const storeOids = [...storeIdSet].map((id) => new Types.ObjectId(id));
    const storeRows =
      storeOids.length === 0
        ? []
        : await this.storeModel
            .find({ _id: { $in: storeOids } })
            .select('name profileImage currency')
            .lean()
            .exec();

    const storeMap = new Map(
      storeRows.map((s) => [String(s._id), s as Record<string, unknown>]),
    );

    const data = docs.map((doc) => {
      const id = String(doc._id);
      const createdAt = (doc as { createdAt?: Date }).createdAt;
      const updatedAt = (doc as { updatedAt?: Date }).updatedAt;
      const rows = (doc.perStoreBreakdown ?? []) as StripePerStoreBreakdownRow[];
      const orderedStoreIds: string[] = [];
      for (const r of rows) {
        const sid = String(r.storeId ?? '').trim();
        if (!sid || !Types.ObjectId.isValid(sid)) continue;
        if (!orderedStoreIds.includes(sid)) {
          orderedStoreIds.push(sid);
        }
      }

      const storesPayload = orderedStoreIds.map((storeId) => {
        const st = storeMap.get(storeId);
        const name =
          typeof st?.['name'] === 'string' ? st['name'].trim() : null;
        const profileImage =
          typeof st?.['profileImage'] === 'string'
            ? st['profileImage'].trim()
            : null;
        const currency =
          typeof st?.['currency'] === 'string' && st['currency'].trim()
            ? st['currency'].trim().toUpperCase()
            : null;
        return {
          _id: storeId,
          name: name || null,
          profileImage: profileImage || null,
          currency: currency || 'CAD',
        };
      });

      const first = storesPayload[0];
      const totalCents = Number(doc.amountTotalCents ?? 0);
      const curRaw = doc.currency != null ? String(doc.currency).trim() : '';
      const cur = curRaw ? curRaw.toUpperCase() : 'CAD';

      const storeBlock = first ?? {
        _id: '',
        name: null as string | null,
        profileImage: null as string | null,
        currency: cur,
      };

      return {
        _id: id,
        createdAt,
        updatedAt,
        status: 'succeeded',
        totalPrice: totalCents / 100,
        shippingPrice: 0,
        currency: cur,
        store: {
          _id: storeBlock._id,
          name: storeBlock.name ?? 'Afrika Meals',
          profileImage: storeBlock.profileImage,
          currency: storeBlock.currency || cur,
        },
        stores: storesPayload,
        stripePaymentId: doc.sessionId,
        stripeEventKind: doc.stripeEventKind ?? null,
        orderIds: (doc.orderIds ?? []).map((x) => String(x)),
      };
    });

    return { data };
  }

  /**
   * Après Payment Sheet : même logique que le webhook `payment_intent.succeeded`,
   * pour les environnements où le webhook Stripe n’atteint pas l’API (local, ngrok).
   * Idempotent via `stripe_processed_checkouts` (clé `sessionId` = id du PaymentIntent).
   */
  async fulfillGroupedPaymentFromClient(
    user: UserModel,
    paymentIntentId: string,
  ): Promise<{ received: boolean; orderIds: string[] }> {
    const id = paymentIntentId.trim();
    if (!id.startsWith('pi_')) {
      throw new BadRequestException('invalid_payment_intent_id');
    }
    const stripe = this.stripe();
    const pi = await stripe.paymentIntents.retrieve(id);
    if (pi.status !== 'succeeded') {
      throw new BadRequestException({
        message: 'payment_intent_not_succeeded',
        status: pi.status,
      });
    }
    const uid = pi.metadata?.uid;
    const storesCsv = pi.metadata?.stores;
    const shipB64 = pi.metadata?.shipB64;
    if (!uid || !storesCsv) {
      throw new BadRequestException('stripe_missing_payment_intent_metadata');
    }
    if (String(uid) !== String(user.id)) {
      throw new ForbiddenException('payment_intent_user_mismatch');
    }
    const metadata = (pi.metadata ?? {}) as Record<
      string,
      string | undefined | null
    >;
    const amountTotalCents =
      pi.amount_received != null
        ? pi.amount_received
        : pi.amount != null
          ? pi.amount
          : undefined;
    const currency =
      pi.currency != null ? String(pi.currency) : undefined;
    const result = await this.fulfillOrdersAfterStripePayment({
      stripePaymentId: pi.id,
      uid: String(uid),
      storesCsv,
      shipB64,
      metadata,
      amountTotalCents,
      currency,
      stripeEventKind: 'payment_intent',
    });
    if (!result.complete) {
      throw new BadRequestException({
        message: 'grouped_payment_fulfillment_incomplete',
        orderIds: result.orderIds,
        errors: result.errors,
      });
    }
    return { received: true, orderIds: result.orderIds };
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as unknown as {
        id: string;
        metadata?: Record<string, string | null | undefined> | null;
        amount_total?: number | null;
        currency?: string | null;
      };
      const uid = session.metadata?.uid;
      const storesCsv = session.metadata?.stores;
      const shipB64 = session.metadata?.shipB64;
      if (!uid || !storesCsv) {
        this.logger.warn('Stripe webhook: missing session metadata');
        return { received: true };
      }
      const metadata = (session.metadata ?? {}) as Record<
        string,
        string | undefined | null
      >;
      const amountTotalCents =
        session.amount_total != null ? session.amount_total : undefined;
      const currency =
        session.currency != null ? String(session.currency) : undefined;
      const sessionResult = await this.fulfillOrdersAfterStripePayment({
        stripePaymentId: session.id,
        uid,
        storesCsv,
        shipB64,
        metadata,
        amountTotalCents,
        currency,
        stripeEventKind: 'checkout_session',
      });
      if (!sessionResult.complete) {
        this.logger.warn(
          `Stripe webhook: incomplete checkout.session ${session.id}`,
        );
      }
      return { received: true };
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as unknown as {
        id: string;
        metadata?: Record<string, string | null | undefined> | null;
        amount?: number | null;
        amount_received?: number | null;
        currency?: string | null;
      };
      const uid = pi.metadata?.uid;
      const storesCsv = pi.metadata?.stores;
      const shipB64 = pi.metadata?.shipB64;
      if (!uid || !storesCsv) {
        this.logger.warn('Stripe webhook: missing payment_intent metadata');
        return { received: true };
      }
      const metadata = (pi.metadata ?? {}) as Record<
        string,
        string | undefined | null
      >;
      const amountTotalCents =
        pi.amount_received != null
          ? pi.amount_received
          : pi.amount != null
            ? pi.amount
            : undefined;
      const currency =
        pi.currency != null ? String(pi.currency) : undefined;
      const piResult = await this.fulfillOrdersAfterStripePayment({
        stripePaymentId: pi.id,
        uid,
        storesCsv,
        shipB64,
        metadata,
        amountTotalCents,
        currency,
        stripeEventKind: 'payment_intent',
      });
      if (!piResult.complete) {
        this.logger.warn(
          `Stripe webhook: incomplete payment_intent ${pi.id}`,
        );
      }
      return { received: true };
    }

    return { received: true };
  }
}
