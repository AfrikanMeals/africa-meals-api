import { isDomainEventsEnabled } from '@modules/domain-event-handlers/domain-event-handlers.util';
import { DomainEventPublisherService } from '../../../common/domain-events/domain-event-publisher.service';
import { DomainEventDraft } from '../../../common/domain-events/domain-event.types';
import { DomainEventType } from '../../../common/domain-events/domain-event-types';
import { domainEventIdFromStripeWebhook } from '../../../common/domain-events/domain-event-id.util';
import { StripeWebhookMetricsService } from './stripe-webhook-metrics.service';
import { resolveStripeCheckoutSuccessUrl } from './stripe-checkout-return-url.util';
import { CheckoutSessionSseService } from '@modules/sse-stream/checkout-session-sse.service';
import { SubscriptionsStripeCheckoutService } from '@modules/subscriptions/subscriptions-stripe-checkout.service';
import { CartService } from '@modules/cart/cart.service';
import {
  customizationSummaryLabel,
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
} from '@modules/cart/cart-customization.util';
import { CouponsService } from '@modules/coupons/coupons.service';
import {
  AdCreditPaymentModel,
  AdCreditPaymentStatusEnum,
} from '@schemas/ad-credit-payment.schema';
import { StripeConnectService } from './stripe-connect.service';
import { StripeConnectTransferService } from './stripe-connect-transfer.service';
import { scaleStorePayoutMinorToPaymentShare } from './stripe-processing-fee.util';
import { OrdersService } from '@modules/orders/orders.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import type { RegionTaxBreakdown } from '@modules/supported-countries/region-tax.constants';
import {
  resolveStoreTaxCountryCode,
} from '@modules/supported-countries/region-tax.util';
import { PlatformFeesService } from '@modules/platform-fees/platform-fees.service';
import { PlatformShippingQuoteService } from '@modules/platform-shipping-settings/platform-shipping-quote.service';
import { StoreService } from '@modules/store/store.service';
import { UsersService } from '@modules/users/users.service';
import { VendorNotificationStripeBillingService } from '@modules/vendor-notifications/vendor-notification-stripe-billing.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  StripePerStoreBreakdownRow,
  StripeProcessedCheckoutModel,
} from '@schemas/stripe-processed-checkout.schema';
import { AddressModel } from '@schemas/address.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import { FilterGroupedPaymentsDto } from './dto/filter-grouped-payments.dto';
import { GroupedStripeCheckoutDto } from './dto/grouped-stripe-checkout.dto';
import {
  stripeAmountFactor,
  stripeMinimumChargeMinorUnits,
} from '../../../utils/stripe-currency-amount.util';
import {
  AppCacheKeys,
  checkoutPreviewCacheTtlMs,
  stableCacheHash,
} from '@common/redis-app-cache';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { DeliveryTipService } from '../delivery-tip.service';
import { DELIVERY_TIP_ALLOCATION_BY_SHIPPING_FEE } from '../delivery-tip-allocation.util';

type StripeClient = InstanceType<typeof Stripe>;

type StripeFulfillResult = {
  complete: boolean;
  orderIds: string[];
  errors: Array<{ storeId: string; error: string }>;
};

const AD_CREDIT_CHECKOUT_METADATA_KIND = 'ad_credit_payment';

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
    {
      storeName: string;
      goodsCents: number;
      shipCents: number;
      taxCents?: number;
      taxBreakdown?: RegionTaxBreakdown;
    }
  >;
  groups: CartGroup[];
  coupons: Array<{ storeId: string; code: string }>;
  /** Adresse livraison choisie au checkout (si au moins une boutique en livraison). */
  checkoutAddressId?: string;
  deliveryTipTotalCents: number;
  tipCentsByStore: Record<string, number>;
  tipAllocationMethod: string;
  /** Facteur montant affiché → unité Stripe (100 = centimes, 1 = XAF entier). */
  amountFactor: number;
  /** Sous-total avant frais de transaction (articles + livraison + taxes + pourboire). */
  subtotalBeforePaymentFeeCents: number;
  orderPaymentFeeCents: number;
  orderPaymentFeeLabel?: string;
  totalCents: number;
  fulfillmentByStoreId: Record<string, 'pickup' | 'delivery'>;
  deliveryMetaByStore: Record<
    string,
    {
      deliverable: boolean;
      distanceKm: number | null;
      maxDeliveryRadiusKm: number | null;
    }
  >;
};

export type GroupedCheckoutPreviewTaxLine = {
  name: string;
  amount: number;
};

export type GroupedCheckoutPreviewPerStore = {
  storeId: string;
  storeName: string;
  fulfillmentMode: 'pickup' | 'delivery';
  goodsCents: number;
  shippingCents: number;
  taxCents: number;
  tipCents: number;
  orderPaymentFeeCents: number;
  deliverable: boolean;
  distanceKm: number | null;
  maxDeliveryRadiusKm: number | null;
  taxLines: GroupedCheckoutPreviewTaxLine[];
};

export type GroupedCheckoutPreviewCacheMeta = {
  hit: boolean;
  ttlMs: number;
};

export type GroupedCheckoutPreviewLine = {
  kind: string;
  label: string;
  amountCents: number;
};

export type GroupedCheckoutPreviewResponse = {
  currency: string;
  amountFactor: number;
  goodsCents: number;
  shippingCents: number;
  taxCents: number;
  deliveryTipCents: number;
  orderPaymentFeeCents: number;
  orderPaymentFeeLabel?: string;
  /** Montant commande (hors frais de transaction plateforme). */
  orderSubtotalCents: number;
  /** Montant PaymentIntent / total débité. */
  totalCents: number;
  lines: GroupedCheckoutPreviewLine[];
  perStore: GroupedCheckoutPreviewPerStore[];
  cache?: GroupedCheckoutPreviewCacheMeta;
};

/** Entrée stable pour clé cache pricing panier / checkout. */
export function cartPricingCacheInputHash(
  cartFingerprint: string,
  dto: GroupedStripeCheckoutDto,
): string {
  const fulfillment = dto.fulfillmentByStoreId ?? {};
  const coupons = (dto.coupons ?? [])
    .map((c) => ({
      storeId: String(c.storeId ?? '').trim(),
      code: String(c.code ?? '')
        .trim()
        .toUpperCase(),
    }))
    .filter((c) => c.storeId && c.code)
    .sort(
      (a, b) =>
        a.storeId.localeCompare(b.storeId) || a.code.localeCompare(b.code),
    );
  return stableCacheHash({
    v: 1,
    cartFingerprint,
    fulfillment,
    addressId: String(dto.addressId ?? '').trim(),
    currency: String(dto.currency ?? '')
      .trim()
      .toUpperCase(),
    deliveryTipTotalCents: Math.max(
      0,
      Math.round(Number(dto.deliveryTipTotalCents) || 0),
    ),
    coupons,
  });
}

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
  const raw = ent != null ? ent['title'] ?? ent['name'] ?? ent['label'] : null;
  let t = raw != null ? String(raw).trim() : '';
  const suffix = customizationSummaryLabel(
    normalizeSelectedComplements(line['selectedComplements']),
    normalizeSelectedSupplements(line['selectedSupplements']),
  );
  if (suffix) {
    t = t ? `${t} — ${suffix}` : suffix;
  }
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

function cartLineUnitCents(
  line: Record<string, unknown>,
  amountFactor: number,
): number {
  const price = Number(line['price'] ?? 0);
  return Math.max(0, Math.round(price * amountFactor + Number.EPSILON));
}

function minorUnitsToDisplayAmount(minor: number, amountFactor: number): number {
  return minor / amountFactor;
}

function normalizeStripeCurrencyCode(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return t || 'cad';
}

function cartLineCurrencyCode(line: Record<string, unknown>): string | null {
  const direct =
    line['currency'] ?? line['currencyCode'] ?? line['currency_code'];
  if (typeof direct === 'string' && direct.trim()) {
    return normalizeStripeCurrencyCode(direct);
  }
  const ent = line['entity'];
  if (ent && typeof ent === 'object' && !Array.isArray(ent)) {
    const obj = ent as Record<string, unknown>;
    const fromEnt =
      obj['currency'] ?? obj['currencyCode'] ?? obj['currency_code'];
    if (typeof fromEnt === 'string' && fromEnt.trim()) {
      return normalizeStripeCurrencyCode(fromEnt);
    }
  }
  return null;
}

function explicitCurrenciesForCartGroup(
  lines: Record<string, unknown>[],
): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    const cur = cartLineCurrencyCode(line);
    if (cur) out.add(cur);
  }
  return out;
}

function currencyForCartGroup(
  lines: Record<string, unknown>[],
  storeCurrency: unknown,
): string {
  const fromLines = explicitCurrenciesForCartGroup(lines);
  if (fromLines.size > 1) return 'multi';
  if (fromLines.size === 1) return [...fromLines][0];
  return normalizeStripeCurrencyCode(storeCurrency);
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
  lineKind: 'goods' | 'shipping' | 'promo_goods' | 'payment_fee' | 'tax' | 'delivery_tip';
  line: Record<string, unknown>;
}): Record<string, string> {
  const { storeId, storeName, lineKind, line } = params;
  const ent = line['entity'] as Record<string, unknown> | undefined;
  const fromEntity =
    ent != null && ent['_id'] != null ? String(ent['_id']).trim() : '';
  const entityId = (
    fromEntity || String(line['entityId'] ?? line['entity_id'] ?? '').trim()
  ).slice(0, 80);
  const typ = String(line['type'] ?? '')
    .trim()
    .slice(0, 40);
  const cartLineId = String(line['_id'] ?? line['id'] ?? '')
    .trim()
    .slice(0, 32);
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
  lineKind: 'goods' | 'shipping' | 'promo_goods' | 'payment_fee' | 'tax' | 'delivery_tip';
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

function checkoutDeliveryTipLine(params: {
  currency: string;
  tipCents: number;
}): CheckoutLineItem | null {
  const { currency, tipCents } = params;
  if (tipCents < 1) return null;
  const line: Record<string, unknown> = {
    type: 'delivery_tip',
    entity: { title: 'Pourboire livreur' },
  };
  return {
    quantity: 1,
    price_data: {
      currency,
      unit_amount: tipCents,
      product_data: {
        name: 'Pourboire livreur',
        description: 'Pourboire pour le livreur (réparti par livraison)',
        metadata: stripeProductMetadata({
          storeId: 'platform',
          storeName: 'Wise Eat',
          lineKind: 'delivery_tip',
          line,
        }),
      },
    },
  };
}

function checkoutPlatformPaymentFeeLine(params: {
  currency: string;
  feeCents: number;
  feeLabel: string;
}): CheckoutLineItem | null {
  const { currency, feeCents, feeLabel } = params;
  if (feeCents < 1) return null;
  const line: Record<string, unknown> = {
    type: 'order_payment_fee',
    entity: { title: feeLabel },
  };
  return {
    quantity: 1,
    price_data: {
      currency,
      unit_amount: feeCents,
      product_data: {
        name: feeLabel.slice(0, 250),
        description:
          'Frais de traitement du paiement (passerelle, carte, etc.)',
        metadata: stripeProductMetadata({
          storeId: 'platform',
          storeName: 'Wise Eat',
          lineKind: 'payment_fee',
          line,
        }),
      },
    },
  };
}

function sumCheckoutLineItemsCents(lineItems: CheckoutLineItem[]): number {
  let sum = 0;
  for (const li of lineItems) {
    const ua = li.price_data?.unit_amount ?? 0;
    const q = li.quantity ?? 1;
    sum += ua * q;
  }
  return sum;
}

function checkoutLineItemKind(li: CheckoutLineItem): string {
  const meta = li.price_data?.product_data?.metadata;
  const kind =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? String((meta as Record<string, unknown>).afrika_line_kind ?? '').trim()
      : '';
  return kind || 'other';
}

function checkoutLineItemAmountCents(li: CheckoutLineItem): number {
  const ua = li.price_data?.unit_amount ?? 0;
  const q = li.quantity ?? 1;
  return ua * q;
}

function groupedCheckoutPreviewFromBuilt(
  built: GroupedStripeBuilt,
): Omit<GroupedCheckoutPreviewResponse, 'cache'> {
  let goodsCents = 0;
  let shippingCents = 0;
  let taxCents = 0;
  for (const row of Object.values(built.payoutByStore)) {
    goodsCents += Math.max(0, row.goodsCents ?? 0);
    shippingCents += Math.max(0, row.shipCents ?? 0);
    taxCents += Math.max(0, row.taxCents ?? 0);
  }
  const lines: GroupedCheckoutPreviewLine[] = built.lineItems.map((li) => ({
    kind: checkoutLineItemKind(li),
    label: String(li.price_data?.product_data?.name ?? '').slice(0, 120),
    amountCents: checkoutLineItemAmountCents(li),
  }));
  const storeIds = Object.keys(built.payoutByStore);
  const payoutMap = new Map<
    string,
    { goodsCents: number; shipCents: number }
  >();
  for (const id of storeIds) {
    const row = built.payoutByStore[id];
    payoutMap.set(id, {
      goodsCents: row?.goodsCents ?? 0,
      shipCents: row?.shipCents ?? 0,
    });
  }
  const feeByStore = allocateOrderPaymentFeeByStore({
    totalFeeCents: built.orderPaymentFeeCents,
    storeIds,
    payoutMap,
    tipCentsByStore: built.tipCentsByStore,
  });
  const perStore: GroupedCheckoutPreviewPerStore[] = storeIds.map((storeId) => {
    const row = built.payoutByStore[storeId];
    const meta = built.deliveryMetaByStore[storeId];
    const mode = built.fulfillmentByStoreId[storeId] ?? 'pickup';
    return {
      storeId,
      storeName: row?.storeName ?? 'Restaurant',
      fulfillmentMode: mode,
      goodsCents: Math.max(0, row?.goodsCents ?? 0),
      shippingCents: Math.max(0, row?.shipCents ?? 0),
      taxCents: Math.max(0, row?.taxCents ?? 0),
      tipCents: Math.max(0, Math.round(built.tipCentsByStore[storeId] ?? 0)),
      orderPaymentFeeCents: Math.max(0, feeByStore[storeId] ?? 0),
      deliverable: meta?.deliverable ?? true,
      distanceKm: meta?.distanceKm ?? null,
      maxDeliveryRadiusKm: meta?.maxDeliveryRadiusKm ?? null,
      taxLines: (row?.taxBreakdown?.lines ?? []).map((l) => ({
        name: l.name,
        amount: l.amount,
      })),
    };
  });
  return {
    currency: built.currency.toUpperCase(),
    amountFactor: built.amountFactor,
    goodsCents,
    shippingCents,
    taxCents,
    deliveryTipCents: Math.max(0, built.deliveryTipTotalCents),
    orderPaymentFeeCents: Math.max(0, built.orderPaymentFeeCents),
    orderPaymentFeeLabel: built.orderPaymentFeeLabel,
    orderSubtotalCents: Math.max(0, built.subtotalBeforePaymentFeeCents),
    totalCents: Math.max(0, built.totalCents),
    lines,
    perStore,
  };
}

function allocateOrderPaymentFeeByStore(args: {
  totalFeeCents: number;
  storeIds: string[];
  payoutMap: Map<string, { goodsCents: number; shipCents: number }>;
  tipCentsByStore: Record<string, number>;
}): Record<string, number> {
  const fee = Math.max(0, Math.round(args.totalFeeCents));
  if (fee < 1 || !args.storeIds.length) return {};
  const weights = args.storeIds.map((storeId) => {
    const row = args.payoutMap.get(storeId);
    const goods = Math.max(0, row?.goodsCents ?? 0);
    const ship = Math.max(0, row?.shipCents ?? 0);
    const tip = Math.max(0, Math.round(args.tipCentsByStore[storeId] ?? 0));
    return goods + ship + tip;
  });
  const allocated = distributeCentsByWeights(weights, fee);
  const out: Record<string, number> = {};
  for (let i = 0; i < args.storeIds.length; i++) {
    const cents = allocated[i] ?? 0;
    if (cents > 0) out[args.storeIds[i]] = cents;
  }
  return out;
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

function sumPayoutMapGrossCents(
  payoutMap: Map<string, { goodsCents: number; shipCents: number }>,
): number {
  let sum = 0;
  for (const row of payoutMap.values()) {
    sum += Math.max(0, row.goodsCents) + Math.max(0, row.shipCents);
  }
  return sum;
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
  private readonly fulfillInFlight = new Map<
    string,
    Promise<StripeFulfillResult>
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly cartService: CartService,
    private readonly quoteService: PlatformShippingQuoteService,
    private readonly deliveryTipService: DeliveryTipService,
    private readonly storeService: StoreService,
    private readonly usersService: UsersService,
    private readonly ordersService: OrdersService,
    private readonly couponsService: CouponsService,
    private readonly stripeConnect: StripeConnectService,
    private readonly stripeTransfers: StripeConnectTransferService,
    private readonly platformFees: PlatformFeesService,
    private readonly supportedCountries: SupportedCountriesService,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly processedModel: Model<StripeProcessedCheckoutModel>,
    @InjectModel(AddressModel.name)
    private readonly addressModel: Model<AddressModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(AdCreditPaymentModel.name)
    private readonly adCreditPaymentModel: Model<AdCreditPaymentModel>,
    @Inject(SubscriptionsStripeCheckoutService)
    private readonly subscriptionStripeCheckout: SubscriptionsStripeCheckoutService,
    private readonly webhookMetrics: StripeWebhookMetricsService,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
    @Inject(forwardRef(() => VendorNotificationStripeBillingService))
    @Optional()
    private readonly vendorSmsBilling?: VendorNotificationStripeBillingService,
    @Optional()
    private readonly domainPublisher?: DomainEventPublisherService,
    @Optional()
    private readonly checkoutSse?: CheckoutSessionSseService,
  ) {}

  private notifyCheckoutSse(
    sessionId: string,
    type: 'checkout_completed' | 'subscription_completed',
    orderIds?: string[],
  ): void {
    const sid = sessionId.trim();
    if (!sid || !this.checkoutSse) return;
    this.checkoutSse.emit(sid, {
      type,
      sessionId: sid,
      orderIds,
      complete: true,
    });
  }

  private async publishStripeDomainEvent<T extends DomainEventType>(
    draft: DomainEventDraft<T>,
  ): Promise<boolean> {
    if (!isDomainEventsEnabled(this.config) || !this.domainPublisher) {
      return false;
    }
    const result = await this.domainPublisher.publish(draft);
    if (!result.ok && result.mode !== 'duplicate') {
      this.logger.warn(
        `Stripe domain event publish skipped type=${draft.type} reason=${result.reason ?? result.mode}`,
      );
    }
    return true;
  }

  private async settleAdCreditFromCheckoutSession(session: {
    id: string;
    metadata?: Record<string, string | null | undefined> | null;
    amount_total?: number | null;
    currency?: string | null;
    payment_status?: string | null;
    status?: string | null;
    payment_intent?: string | { id?: string | null } | null;
  }): Promise<boolean> {
    if (session.metadata?.kind !== AD_CREDIT_CHECKOUT_METADATA_KIND) {
      return false;
    }
    const isPaid =
      session.payment_status === 'paid' || session.status === 'complete';
    if (!isPaid) return true;

    const ownerId = String(session.metadata?.uid ?? '').trim();
    if (!Types.ObjectId.isValid(ownerId)) {
      this.logger.warn(
        `Stripe webhook: ad-credit invalid uid for session ${session.id}`,
      );
      return true;
    }
    const amountPaidCad = Number(
      ((session.amount_total ?? 0) / 100).toFixed(2),
    );
    if (!Number.isFinite(amountPaidCad) || amountPaidCad <= 0) {
      this.logger.warn(
        `Stripe webhook: ad-credit invalid amount for session ${session.id}`,
      );
      return true;
    }
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    const currency =
      String(session.currency ?? 'cad')
        .trim()
        .toUpperCase() || 'CAD';

    await this.adCreditPaymentModel
      .updateOne(
        { stripeCheckoutSessionId: session.id },
        {
          $set: {
            owner: new Types.ObjectId(ownerId),
            amountPaidCad,
            currency,
            status: AdCreditPaymentStatusEnum.PAID,
            stripePaymentIntentId: paymentIntentId,
            paidAt: new Date(),
          },
          $setOnInsert: {
            stripeCheckoutSessionId: session.id,
          },
        },
        { upsert: true },
      )
      .exec();

    return true;
  }

  private async resolveOrderTaxCountryForCheckout(
    user: UserModel,
    addressId?: string,
  ): Promise<string> {
    let deliveryCc: string | undefined;
    const aid = addressId?.trim();
    if (aid) {
      const addr = await this.addressModel
        .findById(aid)
        .select('countryCode')
        .lean()
        .exec();
      deliveryCc = addr?.countryCode;
    }
    return this.supportedCountries.resolveUserTaxCountryCode(user, deliveryCc);
  }

  private async resolveOrderTaxCountryForStore(
    user: UserModel,
    store: unknown,
    addressId?: string,
  ): Promise<string> {
    const fromStore = resolveStoreTaxCountryCode(store);
    if (fromStore) return fromStore;
    return this.resolveOrderTaxCountryForCheckout(user, addressId);
  }

  private async appendOrderTaxLinesForStore(args: {
    user: UserModel;
    currency: string;
    amountFactor: number;
    storeId: string;
    storeName: string;
    store: unknown;
    mode: 'delivery' | 'pickup';
    addressId?: string;
    lineItems: CheckoutLineItem[];
    payoutRow: {
      storeName: string;
      goodsCents: number;
      shipCents: number;
      taxCents?: number;
      taxBreakdown?: RegionTaxBreakdown;
    };
  }): Promise<void> {
    const subtotalCad = minorUnitsToDisplayAmount(
      args.payoutRow.goodsCents + args.payoutRow.shipCents,
      args.amountFactor,
    );
    if (subtotalCad <= 0) return;
    const countryCode = await this.resolveOrderTaxCountryForStore(
      args.user,
      args.store,
      args.addressId,
    );
    const breakdown = await this.supportedCountries.computeTaxesForModule({
      countryCode,
      baseAmount: subtotalCad,
      module: 'order',
    });
    args.payoutRow.taxBreakdown = breakdown;
    args.payoutRow.taxCents = 0;
    for (const taxLine of breakdown.lines) {
      const taxCents = Math.round(
        taxLine.amount * args.amountFactor + Number.EPSILON,
      );
      if (taxCents < 1) continue;
      const li = checkoutLineFromCartRow({
        currency: args.currency,
        storeId: args.storeId,
        storeName: args.storeName,
        mode: args.mode,
        line: {
          type: 'tax',
          entity: { title: `${taxLine.name} — ${args.storeName}` },
        },
        quantity: 1,
        unitAmountCents: taxCents,
        lineKind: 'tax',
        extraDescription: taxLine.description,
      });
      if (li) {
        args.lineItems.push(li);
        args.payoutRow.taxCents = (args.payoutRow.taxCents ?? 0) + taxCents;
      }
    }
  }

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
  private payOnPickupRequestedForStore(
    dto: GroupedStripeCheckoutDto,
    storeId: string,
  ): boolean {
    return dto.payOnPickupByStoreId?.[storeId] === true;
  }

  private async assertPayOnPickupAllowedForStore(
    storeId: string,
    mode: string,
  ): Promise<void> {
    if (mode !== 'pickup') {
      throw new BadRequestException('pickup_pay_on_delivery_pickup_only');
    }
    const offered =
      await this.storeService.isPickupPayOnDeliveryOfferedByStore(storeId);
    if (!offered) {
      throw new BadRequestException({
        message: 'pickup_pay_on_delivery_not_available',
        storeId,
      });
    }
  }

  private async buildGroupedStripePayload(
    user: UserModel,
    dto: GroupedStripeCheckoutDto,
    opts?: { previewAllowUndeliverable?: boolean },
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

    // Si le client envoie une devise explicite (ex. "CAD" résolu depuis l'affichage
    // panier), on la prend comme source de vérité. C'est le comportement attendu :
    // l'utilisateur voit C$7.00 → Stripe doit débiter en CAD, quelle que soit la
    // devise stockée sur la boutique en base.
    const requestedCurrency =
      typeof dto.currency === 'string' && dto.currency.trim()
        ? normalizeStripeCurrencyCode(dto.currency)
        : undefined;

    let currency: string;

    if (requestedCurrency) {
      // Devise fournie par le client → on l'utilise directement sans valider
      // contre store.currency (qui peut être XAF même si les produits sont en CAD).
      currency = requestedCurrency;
    } else {
      // Fallback : résolution automatique depuis les lignes panier puis store.
      const currencies = new Set<string>();
      for (const g of groups) {
        const rawItems = Array.isArray(g.items) ? g.items : [];
        const cartLines = rawItems.filter(
          (x): x is Record<string, unknown> =>
            x != null && typeof x === 'object' && !Array.isArray(x),
        );
        const cur = currencyForCartGroup(cartLines, g.store?.currency);
        if (cur === 'multi') {
          throw new BadRequestException('multi_currency_not_supported');
        }
        currencies.add(cur);
      }
      if (currencies.size !== 1) {
        throw new BadRequestException('multi_currency_not_supported');
      }
      currency = [...currencies][0];
    }

    const amountFactor =
      await this.supportedCountries.resolveStripeAmountFactorForCheckout({
        currency: currency.toUpperCase(),
        userCountryCode: (
          user as UserModel & { appCountryCode?: string }
        ).appCountryCode,
      });
    const stripeMinimumMinor = amountFactor === 1 ? 100 : 50;

    const fulfillment = dto.fulfillmentByStoreId ?? {};
    const needsAddress = groups.some((g) => {
      const id = storeMongoId(g.store);
      const mode = fulfillment[id] ?? 'pickup';
      if (this.payOnPickupRequestedForStore(dto, id)) return false;
      return mode === 'delivery' && g.store?.supportsShipping === true;
    });
    if (needsAddress && !dto.addressId?.trim()) {
      throw new BadRequestException('address_required_for_delivery');
    }

    const lineItems: CheckoutLineItem[] = [];
    const shipCentsByStore: Record<string, number> = {};
    const payoutByStore: GroupedStripeBuilt['payoutByStore'] = {};
    const deliveryMetaByStore: GroupedStripeBuilt['deliveryMetaByStore'] = {};
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

      if (this.payOnPickupRequestedForStore(dto, storeId)) {
        await this.assertPayOnPickupAllowedForStore(storeId, mode);
        continue;
      }

      let shipFee = 0;
      if (mode === 'delivery' && g.store?.supportsShipping && dto.addressId) {
        const q = await this.quoteService.quoteForUser(user, {
          storeId,
          addressId: dto.addressId,
        });
        deliveryMetaByStore[storeId] = {
          deliverable: Boolean(q.deliverable && q.fee != null),
          distanceKm: q.distanceKm ?? null,
          maxDeliveryRadiusKm: q.maxDeliveryRadiusKm ?? null,
        };
        if (!q.deliverable || q.fee == null) {
          if (!opts?.previewAllowUndeliverable) {
            throw new BadRequestException({
              message: 'delivery_not_available',
              storeId,
              distanceKm: q.distanceKm,
              maxDeliveryRadiusKm: q.maxDeliveryRadiusKm,
              undeliverableReason:
                (q as { undeliverableReason?: string | null })
                  .undeliverableReason ?? null,
            });
          }
          shipFee = 0;
        } else {
          shipFee = q.fee;
        }
      } else {
        deliveryMetaByStore[storeId] = {
          deliverable: true,
          distanceKm: null,
          maxDeliveryRadiusKm: null,
        };
      }
      shipCentsByStore[storeId] = Math.round(
        shipFee * amountFactor + Number.EPSILON,
      );

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
          snap.totalAfterDiscount * amountFactor + Number.EPSILON,
        );
        const shipC = shipCentsByStore[storeId] ?? 0;
        const totalCents = targetGoodsCents + shipC;
        if (totalCents < stripeMinimumMinor) {
          throw new BadRequestException({
            message: 'amount_below_stripe_minimum',
            storeId,
            totalCents,
          });
        }
        const grossPerLine = cartLines.map(
          (line) =>
            cartLineUnitCents(line, amountFactor) * cartLineQuantity(line),
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
        await this.appendOrderTaxLinesForStore({
          user,
          currency,
          amountFactor,
          storeId,
          storeName,
          store: g.store,
          mode,
          addressId: dto.addressId?.trim(),
          lineItems,
          payoutRow: payoutByStore[storeId],
        });
        continue;
      }

      // Sans code promo : une ligne Checkout par article (alignée sur le panier).
      for (const line of cartLines) {
        const qty = cartLineQuantity(line);
        const ua = cartLineUnitCents(line, amountFactor);
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

      await this.appendOrderTaxLinesForStore({
        user,
        currency,
        amountFactor,
        storeId,
        storeName,
        store: g.store,
        mode,
        addressId: dto.addressId?.trim(),
        lineItems,
        payoutRow: payoutByStore[storeId],
      });

      let bundleCents = 0;
      for (const line of cartLines) {
        bundleCents +=
          cartLineUnitCents(line, amountFactor) * cartLineQuantity(line);
      }
      bundleCents +=
        (shipCentsByStore[storeId] ?? 0) + (payoutByStore[storeId].taxCents ?? 0);
      if (bundleCents < stripeMinimumMinor) {
        throw new BadRequestException({
          message: 'amount_below_stripe_minimum',
          storeId,
          totalCents: bundleCents,
        });
      }
    }

    if (!lineItems.length) {
      throw new BadRequestException('stripe_checkout_no_online_stores');
    }

    let deliveryTipTotalCents = Math.max(
      0,
      Math.round(Number(dto.deliveryTipTotalCents) || 0),
    );
    let tipCentsByStore: Record<string, number> = {};
    const tipAllocationMethod = DELIVERY_TIP_ALLOCATION_BY_SHIPPING_FEE;

    if (deliveryTipTotalCents > 0) {
      const tipResolved = await this.deliveryTipService.resolveCheckoutTipAllocation(
        user,
        {
          fulfillmentByStoreId: fulfillment,
          addressId: dto.addressId,
          deliveryTipTotalCents,
          coupons,
        },
      );
      deliveryTipTotalCents = tipResolved.deliveryTipTotalCents;
      tipCentsByStore = tipResolved.tipCentsByStore;
      const tipLi = checkoutDeliveryTipLine({
        currency,
        tipCents: deliveryTipTotalCents,
      });
      if (tipLi) lineItems.push(tipLi);
    } else {
      deliveryTipTotalCents = 0;
    }

    const subtotalCents = sumCheckoutLineItemsCents(lineItems);
    const paymentFee =
      await this.platformFees.computeOrderPaymentFeeFromSettings(
        subtotalCents,
        currency,
      );
    if (paymentFee.platformFeeCents > 0) {
      const feeLabel =
        paymentFee.feeMode === 'percent'
          ? `Frais de transaction (${paymentFee.feePercent} %)`
          : 'Frais de transaction';
      const feeLi = checkoutPlatformPaymentFeeLine({
        currency,
        feeCents: paymentFee.platformFeeCents,
        feeLabel,
      });
      if (feeLi) lineItems.push(feeLi);
    }

    if (lineItems.length > 100) {
      throw new BadRequestException({
        message: 'stripe_checkout_line_item_limit',
        count: lineItems.length,
        limit: 100,
      });
    }

    const subtotalBeforePaymentFeeCents = subtotalCents;
    const orderPaymentFeeCents = Math.max(0, paymentFee.platformFeeCents);
    const orderPaymentFeeLabel =
      orderPaymentFeeCents > 0
        ? paymentFee.feeMode === 'percent'
          ? `Frais de transaction (${paymentFee.feePercent} %)`
          : 'Frais de transaction'
        : undefined;
    const totalCents = subtotalBeforePaymentFeeCents + orderPaymentFeeCents;

    return {
      currency,
      lineItems,
      shipCentsByStore,
      payoutByStore,
      groups,
      coupons,
      checkoutAddressId: needsAddress ? dto.addressId?.trim() : undefined,
      deliveryTipTotalCents,
      tipCentsByStore,
      tipAllocationMethod,
      amountFactor,
      subtotalBeforePaymentFeeCents,
      orderPaymentFeeCents,
      orderPaymentFeeLabel,
      totalCents,
      fulfillmentByStoreId: fulfillment as Record<string, 'pickup' | 'delivery'>,
      deliveryMetaByStore,
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
    if (built.checkoutAddressId) {
      base.addressId = built.checkoutAddressId;
    }
    if (built.deliveryTipTotalCents > 0) {
      base.tipTotalCents = String(built.deliveryTipTotalCents);
      base.tipB64 = Buffer.from(
        JSON.stringify(built.tipCentsByStore),
        'utf8',
      ).toString('base64url');
      base.tipAllocMethod = built.tipAllocationMethod;
    }
    base.amtFactor = String(built.amountFactor);
    base.checkoutCur = built.currency.toLowerCase();
    if (built.orderPaymentFeeCents > 0) {
      base.payFeeCents = String(built.orderPaymentFeeCents);
    }
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

  /**
   * Prévisualisation serveur (même calcul que PaymentIntent) — total débité et détail.
   * Résultat mis en cache Redis (TTL court, invalidé à chaque mutation panier).
   */
  async previewGroupedCheckout(
    user: UserModel,
    dto: GroupedStripeCheckoutDto,
  ): Promise<GroupedCheckoutPreviewResponse> {
    const ttlMs = checkoutPreviewCacheTtlMs();
    const cartFingerprint =
      await this.cartService.getCartPricingFingerprint(user);
    const inputHash = cartPricingCacheInputHash(cartFingerprint, dto);
    const cacheKey = AppCacheKeys.cartPricing(String(user.id), inputHash);

    const cached =
      await this.cache.get<Omit<GroupedCheckoutPreviewResponse, 'cache'>>(cacheKey);
    if (cached) {
      return { ...cached, cache: { hit: true, ttlMs } };
    }

    const built = await this.buildGroupedStripePayload(user, dto, {
      previewAllowUndeliverable: true,
    });
    const preview = groupedCheckoutPreviewFromBuilt(built);
    await this.cache.set(cacheKey, preview, ttlMs);
    return { ...preview, cache: { hit: false, ttlMs } };
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
    const rawSuccess = resolveStripeCheckoutSuccessUrl(this.config);
    const rawCancel =
      this.config.get<string>('STRIPE_CHECKOUT_CANCEL_URL') ??
      `${server}/api/billing/stripe/payment-cancel`;

    const successUrl = rawSuccess;
    const cancelUrl = rawCancel;

    const meta = this.groupedMetadata(user, built);
    const nStores = Object.keys(built.payoutByStore).length;
    const piDescription =
      nStores > 1
        ? `Wise Eat · ${nStores} restaurants`
        : `Wise Eat · ${nStores} restaurant`;
    const stripe = this.stripe();
    const pmcId = this.config
      .get<string>('STRIPE_PAYMENT_METHOD_CONFIGURATION')
      ?.trim();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: built.currency,
      // Apple Pay passe par la méthode `card` sur Stripe Checkout
      // (affichage conditionné par la config Stripe + device/browser compatibles).
      payment_method_types: ['card'],
      client_reference_id: String(user.id),
      customer_email: user.email,
      line_items: built.lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: meta,
      // Méthodes dynamiques (Google Pay, Apple Pay, Link…) : Dashboard Stripe
      // ou config dédiée `STRIPE_PAYMENT_METHOD_CONFIGURATION=pmc_…`.
      ...(pmcId ? { payment_method_configuration: pmcId } : {}),
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
    idempotencyKey?: string,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const built = await this.buildGroupedStripePayload(user, dto);
    await this.recheckBeforeStripe(user, built.coupons);

    const totalCents = built.lineItems.reduce((sum, li) => {
      const ua = li.price_data?.unit_amount;
      if (ua == null) return sum;
      const q = li.quantity ?? 1;
      return sum + ua * q;
    }, 0);

    const stripeMinimumMinor = stripeMinimumChargeMinorUnits(built.currency);
    if (totalCents < stripeMinimumMinor) {
      throw new BadRequestException({
        message: 'amount_below_stripe_minimum',
        totalCents,
        stripeMinimumMinor,
        currency: built.currency,
      });
    }

    const meta = this.groupedMetadata(user, built);
    const nStores = Object.keys(built.payoutByStore).length;
    const piDescription =
      nStores > 1
        ? `Wise Eat · ${nStores} restaurants`
        : `Wise Eat · ${nStores} restaurant`;
    const lineBreakdown = built.lineItems.map((li) => ({
      name: li.price_data?.product_data?.name?.slice(0, 64),
      unit_amount: li.price_data?.unit_amount,
      quantity: li.quantity ?? 1,
    }));
    this.logger.log(
      JSON.stringify({
        event: 'grouped_payment_intent_create',
        userId: String(user.id),
        currency: built.currency,
        amountFactor: built.amountFactor,
        totalCents,
        stripeMinimumMinor,
        lineItems: lineBreakdown,
        idempotencyKey: idempotencyKey?.trim().slice(0, 64) || undefined,
      }),
    );
    const stripe = this.stripe();
    const idem = idempotencyKey?.trim().slice(0, 255);
    const pi = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: built.currency,
        automatic_payment_methods: { enabled: true },
        metadata: meta,
        receipt_email: user.email || undefined,
        description: piDescription,
      },
      idem ? { idempotencyKey: idem } : undefined,
    );
    this.logger.log(
      JSON.stringify({
        event: 'grouped_payment_intent_created',
        paymentIntentId: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        status: pi.status,
      }),
    );

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
        return (
          m === 'cart_is_empty' ||
          (Array.isArray(m) && m.includes('cart_is_empty'))
        );
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('cart_is_empty');
  }

  async fulfillFromDomainEvent(params: {
    stripePaymentId: string;
    uid: string;
    storesCsv: string;
    shipB64?: string;
    metadata: Record<string, string | undefined | null>;
    amountTotalCents?: number;
    currency?: string;
    stripeEventKind: 'checkout_session' | 'payment_intent';
  }): Promise<StripeFulfillResult> {
    return this.fulfillOrdersAfterStripePayment(params);
  }

  /** Fulfillment d'une boutique dans un checkout groupé (OPT-008 — parallélisable). */
  private async fulfillStripeGroupedStore(params: {
    storeId: string;
    priorByStore: Map<string, StripePerStoreBreakdownRow>;
    payoutMap: Map<string, { goodsCents: number; shipCents: number }>;
    couponByStore: Map<string, string>;
    shipCentsByStore: Record<string, number>;
    stripePaymentId: string;
    uid: string;
    user: UserModel;
    amountTotalCents?: number;
    currency?: string;
    stripeEventKind: 'checkout_session' | 'payment_intent';
    checkoutAddressId: string;
    tipCentsByStore: Record<string, number>;
    tipAllocationMethod: string;
    amountFactor: number;
    orderPaymentFeeCents?: number;
    totalPayoutGrossCents: number;
    paymentCurrency?: string;
  }): Promise<{
    breakdown: StripePerStoreBreakdownRow;
    orderId?: string;
    error?: { storeId: string; error: string };
  }> {
    const {
      storeId,
      priorByStore,
      payoutMap,
      couponByStore,
      shipCentsByStore,
      stripePaymentId,
      uid,
      user,
      amountTotalCents,
      currency,
      checkoutAddressId,
      tipCentsByStore,
      tipAllocationMethod,
      amountFactor,
      orderPaymentFeeCents,
      totalPayoutGrossCents,
      paymentCurrency,
    } = params;

    const paymentCap = Math.max(0, Math.round(amountTotalCents ?? 0));

    const prior = priorByStore.get(storeId);
    if (prior?.orderId && !prior.error) {
      const alreadyPaid = await this.ordersService.isOrderPaidForStripePayment(
        prior.orderId,
        stripePaymentId,
      );
      if (alreadyPaid) {
        this.ordersService.ensurePaidReceiptEmail(prior.orderId);
        void this.ordersService
          .ensureVendorPaidOrderNotifications(prior.orderId)
          .catch((err) =>
            this.logger.warn(
              `vendor paid notify retry order=${prior.orderId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
        const g = prior.goodsCents ?? 0;
        const s = prior.shipCents ?? 0;
        let transferId = prior.transferId;
        let transferCents = prior.transferCents;
        let platformFeeCents = prior.platformFeeCents;
        let transferSkippedReason = prior.transferSkippedReason;
        try {
          const tr = await this.stripeTransfers.transferForPaidOrder({
            orderId: prior.orderId,
            storeId,
            goodsCents: g,
            shipCents: s,
            stripeParentPaymentId: stripePaymentId,
            paymentTotalCents: amountTotalCents,
            totalPayoutGrossCents,
            paymentCurrency: paymentCurrency ?? currency,
          });
          transferId = tr.transferId ?? transferId;
          transferCents = tr.transferCents;
          platformFeeCents = tr.platformFeeCents;
          transferSkippedReason = tr.skippedReason;
        } catch {
          /* garde les valeurs prior */
        }
        return {
          breakdown: {
            ...prior,
            transferId,
            transferCents,
            platformFeeCents,
            transferSkippedReason,
          },
          orderId: prior.orderId,
        };
      }
    }

    const payoutRow = payoutMap.get(storeId);
    let shipCents =
      payoutRow != null
        ? Math.max(0, payoutRow.shipCents)
        : Math.max(0, Math.round(shipCentsByStore[storeId] ?? 0));
    let goodsCents =
      payoutRow != null ? Math.max(0, payoutRow.goodsCents) : undefined;
    if (
      payoutRow != null &&
      paymentCap > 0 &&
      totalPayoutGrossCents > paymentCap &&
      goodsCents != null
    ) {
      const scaled = scaleStorePayoutMinorToPaymentShare({
        goodsCents,
        shipCents,
        totalPayoutGrossMinor: totalPayoutGrossCents,
        paymentTotalMinor: paymentCap,
      });
      if (scaled.goodsCents !== goodsCents || scaled.shipCents !== shipCents) {
        this.logger.warn(
          `Stripe fulfill payout scaled store=${storeId} ` +
            `goods ${goodsCents}→${scaled.goodsCents} ship ${shipCents}→${scaled.shipCents} ` +
            `(payment=${paymentCap} payoutGross=${totalPayoutGrossCents})`,
        );
      }
      goodsCents = scaled.goodsCents;
      shipCents = scaled.shipCents;
    }
    const couponCode = couponByStore.get(storeId);

    const baseRow: StripePerStoreBreakdownRow = {
      storeId,
      goodsCents: goodsCents ?? 0,
      shipCents,
      couponCode,
    };

    try {
      let oid = await this.ordersService.findRecoverableOrderIdForStorePayment(
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
            oid = await this.ordersService.findRecoverableOrderIdForStorePayment(
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

      const useStripeCents = payoutRow != null;
      const deliveryTipCents =
        shipCents > 0 ? Math.max(0, Math.round(tipCentsByStore[storeId] ?? 0)) : 0;
      await this.ordersService.markOrderPaidWithShipping(
        oid,
        minorUnitsToDisplayAmount(shipCents, amountFactor),
        {
        stripeParentPaymentId: stripePaymentId,
        couponCode,
        chargedGoodsCents: useStripeCents ? goodsCents : undefined,
        chargedShipCents: useStripeCents ? shipCents : undefined,
        subtotalBeforeTax:
          goodsCents != null && shipCents != null
            ? minorUnitsToDisplayAmount(goodsCents + shipCents, amountFactor)
            : undefined,
        deliveryAddressId:
          shipCents > 0 && checkoutAddressId ? checkoutAddressId : undefined,
        currency: currency ? currency.trim().toUpperCase() : undefined,
        deliveryTipCents,
        deliveryTipAllocationMethod:
          deliveryTipCents > 0 ? tipAllocationMethod : undefined,
        orderPaymentFeeCents:
          orderPaymentFeeCents != null && orderPaymentFeeCents > 0
            ? orderPaymentFeeCents
            : undefined,
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

      let transferId: string | undefined;
      let transferCents: number | undefined;
      let platformFeeCents: number | undefined;
      let transferSkippedReason: string | undefined;
      try {
        const tr = await this.stripeTransfers.transferForPaidOrder({
          orderId: oid,
          storeId,
          goodsCents: goodsCents ?? 0,
          shipCents,
          stripeParentPaymentId: stripePaymentId,
          paymentTotalCents: amountTotalCents,
          totalPayoutGrossCents,
          paymentCurrency: paymentCurrency ?? currency,
        });
        transferCents = tr.transferCents;
        platformFeeCents = tr.platformFeeCents;
        transferId = tr.transferId;
        transferSkippedReason = tr.skippedReason;
        if (!tr.transferred && tr.skippedReason) {
          this.logger.warn(
            `Connect transfer skipped store=${storeId} order=${oid}: ${tr.skippedReason}`,
          );
        }
      } catch (trErr) {
        transferSkippedReason =
          trErr instanceof Error ? trErr.message : String(trErr);
        this.logger.error(
          `Connect transfer error store=${storeId} order=${oid}: ${transferSkippedReason}`,
        );
      }

      return {
        breakdown: {
          ...baseRow,
          orderId: oid,
          goodsCents: goodsCents ?? baseRow.goodsCents,
          shipCents,
          transferId,
          transferCents,
          platformFeeCents,
          transferSkippedReason,
        },
        orderId: oid,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Stripe fulfill: order failed for store ${storeId}: ${e}`,
      );
      return {
        breakdown: { ...baseRow, error: errMsg },
        error: { storeId, error: errMsg },
      };
    }
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
    const key = params.stripePaymentId.trim();
    const inflight = this.fulfillInFlight.get(key);
    if (inflight) {
      this.logger.log(`Stripe fulfill: await in-flight ${key}`);
      return inflight;
    }
    const run = this.fulfillOrdersAfterStripePaymentInner(params).finally(() => {
      this.fulfillInFlight.delete(key);
    });
    this.fulfillInFlight.set(key, run);
    return run;
  }

  private async fulfillOrdersAfterStripePaymentInner(params: {
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
    const checkoutAddressId = String(
      metadata?.addressId ?? metadata?.address_id ?? '',
    ).trim();

    let tipCentsByStore: Record<string, number> = {};
    const tipB64 = String(metadata?.tipB64 ?? metadata?.tip_b64 ?? '').trim();
    if (tipB64) {
      try {
        tipCentsByStore = JSON.parse(
          Buffer.from(tipB64, 'base64url').toString('utf8'),
        ) as Record<string, number>;
      } catch {
        tipCentsByStore = {};
      }
    }
    const tipAllocationMethod = String(
      metadata?.tipAllocMethod ?? DELIVERY_TIP_ALLOCATION_BY_SHIPPING_FEE,
    ).trim();

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
      for (const oid of processed.orderIds ?? []) {
        this.ordersService.ensurePaidReceiptEmail(oid);
      }
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
            for (const oid of processed.orderIds ?? []) {
              this.ordersService.ensurePaidReceiptEmail(oid);
            }
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

    const metaFactor = Number(metadata?.amtFactor ?? metadata?.amt_factor ?? 0);
    const amountFactor =
      Number.isFinite(metaFactor) && metaFactor > 0
        ? metaFactor
        : await this.supportedCountries.resolveStripeAmountFactorForCheckout({
            currency: String(currency ?? 'cad').toUpperCase(),
            userCountryCode: (
              user as UserModel & { appCountryCode?: string }
            ).appCountryCode,
          });

    const orderIds: string[] = [...(processed?.orderIds ?? [])];
    const perStoreBreakdown: StripePerStoreBreakdownRow[] = [];
    const fulfillErrors: Array<{ storeId: string; error: string }> = [];

    const totalPayFeeCents = Math.max(
      0,
      Math.round(
        Number(metadata?.payFeeCents ?? metadata?.pay_fee_cents ?? 0),
      ),
    );
    const orderPaymentFeeByStore = allocateOrderPaymentFeeByStore({
      totalFeeCents: totalPayFeeCents,
      storeIds,
      payoutMap,
      tipCentsByStore,
    });

    const totalPayoutGrossCents = sumPayoutMapGrossCents(payoutMap);
    const paymentCurrency = String(
      metadata?.checkoutCur ?? currency ?? '',
    ).trim();

    const storeSlots = await Promise.all(
      storeIds.map((storeId) =>
        this.fulfillStripeGroupedStore({
          storeId,
          priorByStore,
          payoutMap,
          couponByStore,
          shipCentsByStore,
          stripePaymentId,
          uid,
          user,
          amountTotalCents,
          currency,
          stripeEventKind,
          checkoutAddressId,
          tipCentsByStore,
          tipAllocationMethod,
          amountFactor,
          orderPaymentFeeCents: orderPaymentFeeByStore[storeId] ?? 0,
          totalPayoutGrossCents,
          paymentCurrency: paymentCurrency || undefined,
        }),
      ),
    );
    for (const slot of storeSlots) {
      perStoreBreakdown.push(slot.breakdown);
      if (slot.orderId && !orderIds.includes(slot.orderId)) {
        orderIds.push(slot.orderId);
      }
      if (slot.error) {
        fulfillErrors.push(slot.error);
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
      const rows = d.perStoreBreakdown as
        | StripePerStoreBreakdownRow[]
        | undefined;
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
      const rows = (doc.perStoreBreakdown ??
        []) as StripePerStoreBreakdownRow[];
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
      const amountFactor = stripeAmountFactor(cur);

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
        totalPrice: totalCents / amountFactor,
        shippingPrice: 0,
        currency: cur,
        store: {
          _id: storeBlock._id,
          name: storeBlock.name ?? 'Wise Eat',
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
    const currency = pi.currency != null ? String(pi.currency) : undefined;
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
    const started = performance.now();
    let eventType = 'unparsed';
    try {
    const webhookSecrets = this.getStripeWebhookSecrets();
    if (!webhookSecrets.length || !signature || !rawBody?.length) {
      this.logger.warn('Stripe webhook: missing secret, signature or body');
      return { received: false };
    }
    const stripe = this.stripe();
    let event: ReturnType<StripeClient['webhooks']['constructEvent']>;
    let lastError: unknown = null;
    for (const secret of webhookSecrets) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, secret);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) {
      this.logger.warn(
        `Stripe webhook signature: no secret matched (configured=${
          webhookSecrets.length
        }) — ${String(lastError)}`,
      );
      throw new BadRequestException('stripe_invalid_signature');
    }

    eventType = event!.type;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as unknown as {
        id: string;
        metadata?: Record<string, string | null | undefined> | null;
        amount_total?: number | null;
        currency?: string | null;
        payment_status?: string | null;
        status?: string | null;
        payment_intent?: string | { id?: string | null } | null;
      };
      if (session.metadata?.kind === 'vendor_subscription') {
        const subUid = session.metadata?.uid?.trim();
        if (subUid && (await this.publishStripeDomainEvent({
          id: domainEventIdFromStripeWebhook(event.id),
          type: 'subscription.checkout.completed',
          payload: {
            sessionId: session.id,
            userId: subUid,
            storeId: session.metadata?.storeId?.trim() || undefined,
          },
          metadata: {
            source: 'stripe-webhook',
            correlationId: event.id,
          },
        }))) {
          return { received: true };
        }
        await this.subscriptionStripeCheckout.fulfillFromCheckoutSessionObject(
          session,
        );
        this.notifyCheckoutSse(session.id, 'subscription_completed');
        return { received: true };
      }
      const adCreditSettled = await this.settleAdCreditFromCheckoutSession(
        session,
      );
      if (adCreditSettled) {
        return { received: true };
      }
      if (this.vendorSmsBilling) {
        const smsBillingSettled =
          await this.vendorSmsBilling.fulfillFromCheckoutSession(session);
        if (smsBillingSettled) {
          return { received: true };
        }
      }
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
      if (await this.publishStripeDomainEvent({
        id: domainEventIdFromStripeWebhook(event.id),
        type: 'payment.checkout.completed',
        payload: {
          sessionId: session.id,
          userId: uid,
          kind: metadata.kind,
        },
        metadata: {
          source: 'stripe-webhook',
          correlationId: event.id,
          stripeFulfillment: {
            stripePaymentId: session.id,
            uid,
            storesCsv,
            shipB64,
            metadata,
            amountTotalCents,
            currency,
            stripeEventKind: 'checkout_session',
          },
        },
      })) {
        return { received: true };
      }
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
      } else {
        this.notifyCheckoutSse(session.id, 'checkout_completed', sessionResult.orderIds);
      }
      return { received: true };
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as unknown as {
        id: string;
        status?: string | null;
        metadata?: Record<string, string | null | undefined> | null;
        amount?: number | null;
        amount_received?: number | null;
        currency?: string | null;
      };
      if (pi.metadata?.kind === 'vendor_subscription') {
        if (await this.publishStripeDomainEvent({
          id: domainEventIdFromStripeWebhook(event.id),
          type: 'payment.intent.succeeded',
          payload: {
            paymentIntentId: pi.id,
            amountCents:
              pi.amount_received != null
                ? pi.amount_received
                : pi.amount != null
                ? pi.amount
                : 0,
            currency: pi.currency != null ? String(pi.currency) : 'eur',
            userId: pi.metadata?.uid?.trim() || undefined,
          },
          metadata: {
            source: 'stripe-webhook',
            correlationId: event.id,
            stripeSubscriptionIntent: {
              id: pi.id,
              status: 'succeeded',
              metadata: pi.metadata ?? {},
              amount: pi.amount,
              amount_received: pi.amount_received,
              currency: pi.currency,
            },
          },
        })) {
          return { received: true };
        }
        await this.subscriptionStripeCheckout.fulfillFromPaymentIntentObject({
          ...pi,
          status: 'succeeded',
        });
        return { received: true };
      }
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
      const currency = pi.currency != null ? String(pi.currency) : undefined;
      if (await this.publishStripeDomainEvent({
        id: domainEventIdFromStripeWebhook(event.id),
        type: 'payment.intent.succeeded',
        payload: {
          paymentIntentId: pi.id,
          amountCents: amountTotalCents ?? 0,
          currency: currency ?? 'eur',
          userId: uid,
        },
        metadata: {
          source: 'stripe-webhook',
          correlationId: event.id,
          stripeFulfillment: {
            stripePaymentId: pi.id,
            uid,
            storesCsv,
            shipB64,
            metadata,
            amountTotalCents,
            currency,
            stripeEventKind: 'payment_intent',
          },
        },
      })) {
        return { received: true };
      }
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
        this.logger.warn(`Stripe webhook: incomplete payment_intent ${pi.id}`);
      }
      return { received: true };
    }

    if (event.type === 'account.updated') {
      const account = event.data.object as {
        id: string;
        charges_enabled?: boolean;
        payouts_enabled?: boolean;
        details_submitted?: boolean;
        requirements?: {
          disabled_reason?: string | null;
          currently_due?: string[] | null;
          past_due?: string[] | null;
        } | null;
      };
      if (await this.publishStripeDomainEvent({
        id: domainEventIdFromStripeWebhook(event.id),
        type: 'payment.connect.account.updated',
        payload: {
          accountId: account.id,
        },
        metadata: {
          source: 'stripe-webhook',
          correlationId: event.id,
          stripeConnectAccount: account,
        },
      })) {
        return { received: true };
      }
      await this.stripeConnect.handleAccountUpdated(account);
      return { received: true };
    }

    if (
      event.type === 'payout.paid' ||
      event.type === 'payout.failed' ||
      event.type === 'payout.canceled' ||
      (event.type === 'payout.updated' &&
        (event.data.object as { status?: string }).status === 'in_transit')
    ) {
      const connectAccountId = String(
        (event as { account?: string | null }).account ?? '',
      ).trim();
      if (connectAccountId) {
        await this.stripeConnect.handlePayoutUpdated(
          connectAccountId,
          event.data.object as {
            id: string;
            amount?: number | null;
            currency?: string | null;
            status?: string | null;
            arrival_date?: number | null;
          },
        );
      }
      return { received: true };
    }

    return { received: true };
    } finally {
      this.webhookMetrics.record(performance.now() - started, eventType);
    }
  }

  /**
   * Paiement à la collecte (pickup) sans Stripe — une commande par boutique du panier.
   */
  async createPickupPayOnDeliveryCheckout(
    user: UserModel,
    dto: GroupedStripeCheckoutDto,
  ): Promise<{ orderIds: string[]; pickupStoreIds: string[] }> {
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

    const fulfillment = dto.fulfillmentByStoreId ?? {};
    const couponByStore = new Map(
      coupons.map((c) => [c.storeId, c.code] as const),
    );
    const orderIds: string[] = [];
    const pickupStoreIds: string[] = [];

    for (const g of groups) {
      const storeId = storeMongoId(g.store);
      if (!storeId) continue;

      if (!this.payOnPickupRequestedForStore(dto, storeId)) {
        continue;
      }

      const mode = fulfillment[storeId] ?? 'pickup';
      await this.assertPayOnPickupAllowedForStore(storeId, mode);

      const cartLines = (g.items ?? []).filter(
        (x): x is Record<string, unknown> =>
          x != null && typeof x === 'object' && !Array.isArray(x),
      );
      const currency = currencyForCartGroup(cartLines, g.store?.currency);
      if (currency === 'multi') {
        throw new BadRequestException('multi_currency_not_supported');
      }

      const order = await this.storeService.createOrderFromCart(storeId, user);
      const oid =
        (order as { _id?: Types.ObjectId })?._id?.toString() ??
        (order as { id?: string })?.id ??
        null;
      if (!oid) {
        throw new BadRequestException('order_create_failed');
      }

      const couponCode = couponByStore.get(storeId);

      const amountFactor =
        await this.supportedCountries.resolveStripeAmountFactorForCheckout({
          currency: (currency || 'CAD').toUpperCase(),
          userCountryCode: (
            user as UserModel & { appCountryCode?: string }
          ).appCountryCode,
        });

      let goodsCents = 0;
      if (couponCode) {
        const snap = await this.cartService.previewCouponForStore(
          user,
          storeId,
          couponCode,
        );
        goodsCents = Math.round(
          snap.totalAfterDiscount * amountFactor + Number.EPSILON,
        );
      } else {
        goodsCents = cartLines.reduce(
          (sum, line) =>
            sum +
            cartLineUnitCents(line, amountFactor) * cartLineQuantity(line),
          0,
        );
      }

      const shipCents = 0;
      const subtotalBeforeTax = minorUnitsToDisplayAmount(
        goodsCents + shipCents,
        amountFactor,
      );

      await this.ordersService.markOrderPaidWithShipping(oid, 0, {
        payOnPickup: true,
        couponCode,
        currency: currency || undefined,
        chargedGoodsCents: goodsCents,
        chargedShipCents: shipCents,
        chargedTaxCents: 0,
        subtotalBeforeTax,
        taxTotal: 0,
        taxLines: [],
      });

      if (couponCode) {
        await this.couponsService.recordUsageAfterSuccessfulPayment(
          storeId,
          couponCode,
        );
      }

      orderIds.push(oid);
      pickupStoreIds.push(storeId);
    }

    if (!orderIds.length) {
      throw new BadRequestException('pickup_pay_on_delivery_no_stores');
    }

    return { orderIds, pickupStoreIds };
  }

  private getStripeWebhookSecrets(): string[] {
    const primary = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    const extra = this.config.get<string>('STRIPE_WEBHOOK_SECRETS') ?? '';
    return `${primary},${extra}`
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('whsec_'));
  }
}
