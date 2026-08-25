import {
  allocatePlatformFeeToGoodsCents,
  allocateStripeProcessingFeeShareCents,
  estimateStripeProcessingFeeCents,
} from '@modules/billing/stripe/stripe-processing-fee.util';
import { CouponsService } from '@modules/coupons/coupons.service';
import { resolvePlatformShippingRegionCode } from '@modules/platform-shipping-settings/platform-shipping-region.util';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import {
  computePlatformShippingFeeFromDistance,
  extractLatLonFromGeoPoint,
} from '@modules/platform-shipping-settings/shipping-quote.util';
import { DrivingDistanceService } from '@modules/route-optimization/driving-distance.service';
import {
  computePayoutFeeSplit,
  PlatformFeesService,
} from '@modules/platform-fees/platform-fees.service';
import {
  parseOptionalCommissionStrategy,
  resolveEffectiveCommissionStrategy,
} from '@modules/platform-fees/platform-order-commission.util';
import { SubscriptionPlanOrderCommissionService } from '@modules/subscriptions/subscription-plan-order-commission.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import {
  countryCodeFromStoreRegion,
  resolveStoreTaxCountryCode,
} from '@modules/supported-countries/region-tax.util';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductModel } from '@schemas/product.schema';
import { StoreCouponDiscountTypeEnum } from '@schemas/store_coupon.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  CartSimulatorFulfillmentMode,
  CartSimulatorPreviewDto,
} from './dto/cart-simulator-preview.dto';
import {
  customizationSummaryLabel,
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
  repriceCustomizationFromProductCatalog,
} from '@modules/cart/cart-customization.util';
import { computeCartSimulatorCourierBreakdown } from './cart-simulator-courier.util';
import {
  cartSimulatorCouponFactor,
  normalizeCartSimulatorItems,
  resolveCartSimulatorCurrency,
  resolveCartSimulatorRegionCode,
  resolveCartSimulatorTaxCountryCode,
  stackVendorNetAfterFeesCents,
} from './cart-simulator-items.util';

/** Message code coupon pour soft-fail simulateur (pas de 400 sur preview). */
function couponSoftFailMessage(err: unknown): string {
  if (err instanceof BadRequestException) {
    const body = err.getResponse();
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object' && 'message' in body) {
      const m = (body as { message?: string | string[] }).message;
      return Array.isArray(m) ? m.join(', ') : String(m ?? 'coupon_invalid');
    }
  }
  return 'coupon_invalid';
}

type ProductLean = {
  _id: unknown;
  title?: string;
  price?: number;
  discountPrice?: number;
  listPrice?: number;
  listDiscountPrice?: number;
  variants?: unknown;
  complements?: unknown;
  supplements?: unknown;
  commissionRetrieveStrategy?: string | null;
};

function resolveProductUnitPrice(product: ProductLean): number {
  const listDiscount = Number(product.listDiscountPrice ?? 0);
  if (listDiscount > 0) return listDiscount;
  const discount = Number(product.discountPrice ?? 0);
  if (discount > 0) return discount;
  const list = Number(product.listPrice ?? 0);
  if (list > 0) return list;
  return Math.max(0, Number(product.price ?? 0));
}

/** Prix variante (discount si pertinent), sinon prix catalogue produit. */
function resolveCatalogUnitPriceWithVariant(
  product: ProductLean,
  selectedVariantLabel?: string,
): number {
  const label = String(selectedVariantLabel ?? '').trim();
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (label && variants.length) {
    const match = variants.find((v) => {
      const row = (v ?? {}) as Record<string, unknown>;
      return String(row.label ?? row.name ?? '').trim() === label;
    }) as Record<string, unknown> | undefined;
    if (match) {
      const vp = Number(match.price ?? 0);
      const vd = Number(match.discountPrice ?? match.discount_price ?? 0);
      if (vd > 0 && (vp <= 0 || vd < vp)) return vd;
      if (vp > 0) return vp;
    }
  }
  return resolveProductUnitPrice(product);
}

function minorToDisplay(minor: number, amountFactor: number): number {
  if (amountFactor < 1) return minor;
  return minor / amountFactor;
}

function displayToMinor(display: number, amountFactor: number): number {
  return Math.max(0, Math.round(display * amountFactor + Number.EPSILON));
}

@Injectable()
export class CartSimulatorService {
  constructor(
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    private readonly storeAccess: StoreAccessService,
    private readonly supportedCountries: SupportedCountriesService,
    private readonly platformShippingSettings: PlatformShippingSettingsService,
    private readonly platformFees: PlatformFeesService,
    private readonly planOrderCommission: SubscriptionPlanOrderCommissionService,
    private readonly coupons: CouponsService,
    // SoT distance routière — même moteur que le quote checkout.
    private readonly drivingDistance: DrivingDistanceService,
  ) {}

  async preview(user: UserModel, dto: CartSimulatorPreviewDto) {
    const storeId = String(dto.storeId ?? '').trim();
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException('invalid_store_id');
    }
    await this.storeAccess.assertStoreAccess(user, storeId);

    const store = await this.storeModel
      .findById(storeId)
      .populate({ path: 'address', select: 'location countryCode' })
      .select(
        'name region currency supportsShipping address commissionRetrieveStrategy',
      )
      .lean()
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    // Devise = region || adresse (pas téléphone/CAD → CA via resolveStoreTaxCountryCode).
    const regionCc =
      resolveCartSimulatorRegionCode(store) ||
      resolveStoreTaxCountryCode(store);
    // getCountryCurrency : pas de filtre active:true (sinon CM inactive → CAD).
    const regionCurrency = regionCc
      ? await this.supportedCountries.getCountryCurrency(regionCc)
      : null;
    const currency = resolveCartSimulatorCurrency({
      regionCurrency,
      storeCurrency: store.currency,
      regionCode: regionCc,
    });
    const deliveryCc = String(dto.deliveryCountryCode ?? '').trim().toUpperCase();
    const taxCountryFallback = regionCc;
    const amountFactor =
      await this.supportedCountries.resolveStripeAmountFactorForCheckout({
        currency,
        userCountryCode: deliveryCc || taxCountryFallback || user.appCountryCode,
      });

    let normalized;
    try {
      normalized = normalizeCartSimulatorItems(dto.items);
    } catch {
      throw new BadRequestException('cart_simulator_no_valid_items');
    }

    const catalogIds = [
      ...new Set(
        normalized
          .filter((i) => i.kind === 'catalog')
          .map((i) => i.productId),
      ),
    ];

    const products = catalogIds.length
      ? ((await this.productModel
          .find({ _id: { $in: catalogIds }, store: storeId })
          .select(
            'title price discountPrice listPrice listDiscountPrice variants complements supplements commissionRetrieveStrategy',
          )
          .lean()
          .exec()) as unknown as ProductLean[])
      : [];

    const productById = new Map(
      products.map((p) => [String(p._id), p] as const),
    );

    const lines: Array<{
      productId: string;
      title: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      /** Stratégie effective figée pour le split commission. */
      commissionStrategy?: 'on_payout' | 'add_to_price';
    }> = [];
    let goodsDisplay = 0;
    // Stratégie boutique une seule fois (prix libres + repli lignes).
    const storeCommissionStrategy =
      await this.planOrderCommission.getCommissionRetrieveStrategyForStore(
        storeId,
      );

    for (const item of normalized) {
      if (item.kind === 'custom') {
        // Prix libre : traité comme prix vendeur, majoré si stratégie boutique add_to_price.
        const customerUnit =
          await this.planOrderCommission.resolveCustomerUnitPriceForStore(
            storeId,
            item.unitPrice,
            storeCommissionStrategy,
          );
        const lineTotal = customerUnit * item.quantity;
        goodsDisplay += lineTotal;
        lines.push({
          productId: item.lineKey,
          title: item.title,
          quantity: item.quantity,
          unitPrice: customerUnit,
          lineTotal,
          commissionStrategy: storeCommissionStrategy,
        });
        continue;
      }

      const product = productById.get(item.productId);
      if (!product) {
        throw new BadRequestException({
          message: 'cart_simulator_product_not_found',
          productId: item.productId,
        });
      }

      // 1. Prix vendeur (variante + extras) — base avant markup client.
      const base = resolveCatalogUnitPriceWithVariant(
        product,
        item.selectedVariantLabel,
      );
      const rawComplements = normalizeSelectedComplements(
        item.selectedComplements,
      );
      const rawSupplements = normalizeSelectedSupplements(
        item.selectedSupplements,
      );
      const repriced = repriceCustomizationFromProductCatalog(
        {
          complements: product.complements,
          supplements: product.supplements,
        },
        rawComplements,
        rawSupplements,
      );
      // 2. Stratégie produit → boutique (même priorité que panier réel).
      const lineStrategy = resolveEffectiveCommissionStrategy(
        parseOptionalCommissionStrategy(product.commissionRetrieveStrategy),
        storeCommissionStrategy,
      );
      // 3. Prix client : add_to_price majore ; on_payout = prix vendeur.
      const unitPrice =
        await this.planOrderCommission.resolveCustomerLineUnitPriceForStore(
          storeId,
          base,
          {
            complements: repriced.complements,
            supplements: repriced.supplements,
          },
          lineStrategy,
        );
      const lineTotal = unitPrice * item.quantity;
      goodsDisplay += lineTotal;
      const summary = customizationSummaryLabel(
        repriced.complements,
        repriced.supplements,
        item.selectedVariantLabel,
      );
      const baseTitle = String(product.title ?? 'Article');
      lines.push({
        productId: item.productId,
        title: summary ? `${baseTitle} (${summary})` : baseTitle,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
        commissionStrategy: lineStrategy,
      });
    }

    const mode = dto.fulfillmentMode;
    let shippingDisplay = 0;
    let shippingMeta: {
      deliverable: boolean;
      distanceKm: number | null;
      maxDeliveryRadiusKm: number;
      reason?: string;
      storeLatitude?: number | null;
      storeLongitude?: number | null;
    } | null = null;
    // Retenue livraison : défauts alignés plateforme ; écrasés si settings région chargés.
    let withheldMode = 'percent';
    let withheldFixed = 0;
    let withheldPercent = 0;

    if (
      mode === CartSimulatorFulfillmentMode.DELIVERY &&
      store.supportsShipping === true
    ) {
      const lat = Number(dto.deliveryLatitude);
      const lon = Number(dto.deliveryLongitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new BadRequestException('delivery_coordinates_required');
      }

      const shopAddr = store.address as
        | {
            location?: { type?: string; coordinates?: number[] };
            countryCode?: string;
          }
        | null
        | undefined;
      const storeAddrCc =
        shopAddr && typeof shopAddr === 'object' && !Array.isArray(shopAddr)
          ? String(shopAddr.countryCode ?? '').trim().toUpperCase()
          : '';
      const regionCode = resolvePlatformShippingRegionCode([
        store.region,
        countryCodeFromStoreRegion(store),
        storeAddrCc,
        deliveryCc,
        user.appCountryCode,
      ]);
      const settings =
        await this.platformShippingSettings.getPublicSettings(regionCode);
      withheldMode = settings.deliveryWithheldFeeMode;
      withheldFixed = settings.deliveryWithheldFeeFixed;
      withheldPercent = settings.deliveryWithheldFeePercent;

      const origin = extractLatLonFromGeoPoint(shopAddr?.location);
      if (!origin) {
        shippingMeta = {
          deliverable: false,
          distanceKm: null,
          maxDeliveryRadiusKm: settings.maxDeliveryRadiusKm,
          reason: 'store_address_missing_coordinates',
          storeLatitude: null,
          storeLongitude: null,
        };
      } else {
        // Fix: facturer l’itinéraire routier, pas le vol d’oiseau (perte vs Gmaps).
        const billed = await this.drivingDistance.resolveBillableDistanceKm({
          origin,
          dest: { lat, lon },
        });
        const distanceKm = billed.distanceKm;
        const computed = computePlatformShippingFeeFromDistance(
          settings,
          distanceKm,
        );
        shippingDisplay = computed.deliverable ? computed.total : 0;
        shippingMeta = {
          deliverable: computed.deliverable,
          distanceKm,
          maxDeliveryRadiusKm: settings.maxDeliveryRadiusKm,
          storeLatitude: origin.lat,
          storeLongitude: origin.lon,
          ...(computed.deliverable
            ? {}
            : { reason: 'outside_delivery_radius' }),
        };
      }
    }

    // 1. Coupon boutique sur sous-total articles (soft-fail si code invalide).
    const couponCodeRaw = String(dto.couponCode ?? '').trim().toUpperCase();
    let couponDiscountDisplay = 0;
    let couponDiscountType: StoreCouponDiscountTypeEnum | null = null;
    let couponValue: number | null = null;
    let couponError: string | null = null;
    if (couponCodeRaw) {
      try {
        const coupon = await this.coupons.getActiveCouponForStore(
          storeId,
          couponCodeRaw,
        );
        couponDiscountDisplay = this.coupons.computeDiscountForSubtotal(
          goodsDisplay,
          coupon.discountType,
          coupon.value,
        );
        couponDiscountType = coupon.discountType;
        couponValue = Number(coupon.value) || 0;
      } catch (err) {
        couponError = couponSoftFailMessage(err);
      }
    }
    const goodsAfterCouponDisplay = Math.max(
      0,
      goodsDisplay - couponDiscountDisplay,
    );
    const couponFactor = cartSimulatorCouponFactor(
      goodsDisplay,
      couponDiscountDisplay,
    );

    // Taxes région : boutique d’abord (comme checkout), puis adresse livraison.
    const taxCountry = resolveCartSimulatorTaxCountryCode({
      storeRegionCode: regionCc,
      storeTaxFallback: resolveStoreTaxCountryCode(store),
      deliveryCountryCode: deliveryCc,
      userTaxCountryCode: this.supportedCountries.resolveUserTaxCountryCode(
        user,
        deliveryCc,
      ),
    });
    // Base = articles après coupon + livraison (hors tip / frais transaction).
    const taxBaseDisplay = goodsAfterCouponDisplay + shippingDisplay;
    const taxBreakdown = await this.supportedCountries.computeTaxesForModule({
      countryCode: taxCountry,
      baseAmount: taxBaseDisplay,
      module: 'order',
      // Fix: getTaxRulesForCountry filtre active:true → taxes CM/CA configurées ignorées.
      allowInactiveRegion: true,
    });

    const tipDisplay =
      mode === CartSimulatorFulfillmentMode.DELIVERY
        ? Math.max(0, Number(dto.deliveryTip) || 0)
        : 0;

    const subtotalBeforePaymentFeeDisplay =
      taxBaseDisplay + taxBreakdown.taxTotal + tipDisplay;
    const subtotalBeforePaymentFeeCents = displayToMinor(
      subtotalBeforePaymentFeeDisplay,
      amountFactor,
    );

    const paymentFee = await this.platformFees.computeOrderPaymentFeeFromSettings(
      subtotalBeforePaymentFeeCents,
      currency,
    );
    const orderPaymentFeeDisplay = minorToDisplay(
      paymentFee.platformFeeCents,
      amountFactor,
    );
    const orderPaymentFeeLabel =
      paymentFee.platformFeeCents > 0
        ? paymentFee.feeMode === 'percent'
          ? `Frais de transaction (${paymentFee.feePercent} %)`
          : 'Frais de transaction'
        : undefined;

    const customerTotalDisplay =
      subtotalBeforePaymentFeeDisplay + orderPaymentFeeDisplay;

    // Commission sur CA articles après coupon (vendeur finance le coupon).
    const goodsCents = displayToMinor(goodsAfterCouponDisplay, amountFactor);
    const shipCents = displayToMinor(shippingDisplay, amountFactor);
    const commissionSplit =
      await this.planOrderCommission.computeVendorTransferSplitForStore(
        storeId,
        {
          goodsCents,
          shipCents,
          lineItems: lines.map((line) => ({
            unitPrice: line.unitPrice * couponFactor,
            quantity: line.quantity,
            lineTotalMinor: displayToMinor(
              line.lineTotal * couponFactor,
              amountFactor,
            ),
            ...(line.commissionStrategy
              ? { strategy: line.commissionStrategy }
              : {}),
          })),
        },
      );
    const platformFeeOnGoodsCents = allocatePlatformFeeToGoodsCents({
      platformFeeCents: commissionSplit.platformFeeCents,
      goodsCents,
      shipCents,
    });
    const vendorNetCents = Math.max(0, goodsCents - platformFeeOnGoodsCents);

    // 2. Frais Stripe processing estimés (part articles vendeur).
    const chargeCents = displayToMinor(customerTotalDisplay, amountFactor);
    const stripeFeeTotalCents = estimateStripeProcessingFeeCents(chargeCents);
    const stripeFeeShareCents = allocateStripeProcessingFeeShareCents({
      totalStripeFeeCents: stripeFeeTotalCents,
      paymentAmountCents: chargeCents,
      sliceAmountCents: goodsCents,
      maxDeductibleCents: vendorNetCents,
    });

    // 3. Frais payout Wise Eat (prélevés avant payout Stripe Connect).
    const afterStripeCents = Math.max(0, vendorNetCents - stripeFeeShareCents);
    const payoutSettings =
      await this.planOrderCommission.resolvePayoutFeeForStore(storeId);
    const payoutSplit = computePayoutFeeSplit(
      afterStripeCents,
      {
        payoutFeeMode: payoutSettings.payoutFeeMode,
        payoutFeeFixed: payoutSettings.payoutFeeFixed,
        payoutFeePercent: payoutSettings.payoutFeePercent,
      },
      payoutSettings.currency,
    );
    const stacked = stackVendorNetAfterFeesCents({
      vendorNetAfterCommissionCents: vendorNetCents,
      stripeFeeShareCents,
      payoutFeeCents: payoutSplit.platformFeeCents,
    });

    const commissionSettings =
      await this.planOrderCommission.resolveOrderCommissionForStore(storeId);

    // Gains livreur : hors cartes client/vendeur ; pickup ou hors zone → applicable false.
    const courier = computeCartSimulatorCourierBreakdown({
      fulfillmentIsDelivery: mode === CartSimulatorFulfillmentMode.DELIVERY,
      deliverable: shippingMeta?.deliverable === true,
      shippingDisplay,
      tipDisplay,
      withheldMode,
      withheldFixed,
      withheldPercent,
      amountFactor,
      chargeCents,
      stripeFeeTotalCents,
    });

    return {
      storeId,
      storeName: String(store.name ?? ''),
      currency,
      fulfillmentMode: mode,
      customerAddressLabel: String(dto.customerAddressLabel ?? '').trim() || null,
      lines,
      customer: {
        goods: goodsDisplay,
        couponCode: couponCodeRaw || null,
        couponDiscount: couponDiscountDisplay,
        couponDiscountType,
        couponValue,
        couponError,
        goodsAfterCoupon: goodsAfterCouponDisplay,
        shipping: shippingDisplay,
        shippingMeta,
        taxes: taxBreakdown,
        taxTotal: taxBreakdown.taxTotal,
        /** Pays ISO utilisé pour les taxes région (transparence UI). */
        taxCountryCode: taxBreakdown.countryCode || taxCountry || null,
        deliveryTip: tipDisplay,
        orderPaymentFee: orderPaymentFeeDisplay,
        orderPaymentFeeLabel,
        subtotalBeforePaymentFee: subtotalBeforePaymentFeeDisplay,
        total: customerTotalDisplay,
      },
      vendor: {
        grossGoods: minorToDisplay(goodsCents, amountFactor),
        grossShipping: minorToDisplay(shipCents, amountFactor),
        platformCommission: minorToDisplay(platformFeeOnGoodsCents, amountFactor),
        platformCommissionTotal: minorToDisplay(
          commissionSplit.platformFeeCents,
          amountFactor,
        ),
        platformCommissionMode: commissionSplit.feeMode,
        platformCommissionPercent: commissionSplit.feePercent,
        platformCommissionFixed: commissionSplit.feeFixedCad,
        platformCommissionTiered:
          commissionSettings.config.tiers.length > 0,
        commissionSource: commissionSettings.source,
        /** Stratégie boutique (les lignes peuvent surcharger produit). */
        commissionRetrieveStrategy: storeCommissionStrategy,
        /** Net Connect après commission commande (avant Stripe / payout). */
        netTransfer: minorToDisplay(vendorNetCents, amountFactor),
        stripeProcessingFeeEstimate: minorToDisplay(
          stripeFeeShareCents,
          amountFactor,
        ),
        stripeProcessingFeeTotalEstimate: minorToDisplay(
          stripeFeeTotalCents,
          amountFactor,
        ),
        netTransferAfterStripe: minorToDisplay(
          stacked.netAfterStripeCents,
          amountFactor,
        ),
        /** Frais payout Wise Eat prélevés avant payout Stripe Connect. */
        payoutFeeEstimate: minorToDisplay(
          payoutSplit.platformFeeCents,
          amountFactor,
        ),
        payoutFeeMode: payoutSplit.feeMode,
        payoutFeePercent: payoutSplit.feePercent,
        payoutFeeFixed: payoutSplit.feeFixedCad,
        payoutFeeSource: payoutSettings.source,
        /** Net banque estimé après frais payout (Stripe Connect cash-out). */
        netAfterPayout: minorToDisplay(
          stacked.netAfterPayoutCents,
          amountFactor,
        ),
        note:
          mode === CartSimulatorFulfillmentMode.DELIVERY
            ? 'La livraison et le pourboire sont payés par le client mais ne sont pas versés au vendeur. Frais Stripe processing + payout Wise Eat = estimations.'
            : 'Frais Stripe processing + payout Wise Eat (Stripe Connect) = estimations ; hors code cadeau.',
      },
      courier,
      disclaimer:
        'Simulation indicative — taxes région, coupon, frais Stripe processing et frais payout Wise Eat (Stripe Connect) inclus ; hors code cadeau.',
    };
  }
}
