import { allocatePlatformFeeToGoodsCents } from '@modules/billing/stripe/stripe-processing-fee.util';
import { resolvePlatformShippingRegionCode } from '@modules/platform-shipping-settings/platform-shipping-region.util';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import {
  computePlatformShippingFeeFromDistance,
  extractLatLonFromGeoPoint,
  haversineDistanceKm,
} from '@modules/platform-shipping-settings/shipping-quote.util';
import { PlatformFeesService } from '@modules/platform-fees/platform-fees.service';
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
import {
  normalizeCartSimulatorItems,
  resolveCartSimulatorCurrency,
  resolveCartSimulatorRegionCode,
} from './cart-simulator-items.util';

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
    } | null = null;

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

      const origin = extractLatLonFromGeoPoint(shopAddr?.location);
      if (!origin) {
        shippingMeta = {
          deliverable: false,
          distanceKm: null,
          maxDeliveryRadiusKm: settings.maxDeliveryRadiusKm,
          reason: 'store_address_missing_coordinates',
        };
      } else {
        const distanceKm = haversineDistanceKm(
          origin.lat,
          origin.lon,
          lat,
          lon,
        );
        const computed = computePlatformShippingFeeFromDistance(
          settings,
          distanceKm,
        );
        shippingDisplay = computed.deliverable ? computed.total : 0;
        shippingMeta = {
          deliverable: computed.deliverable,
          distanceKm: Math.round(distanceKm * 1000) / 1000,
          maxDeliveryRadiusKm: settings.maxDeliveryRadiusKm,
          ...(computed.deliverable
            ? {}
            : { reason: 'outside_delivery_radius' }),
        };
      }
    }

    // Taxes alignées sur la région devise (pas le téléphone CA legacy).
    const taxCountry =
      regionCc ||
      resolveStoreTaxCountryCode(store) ||
      deliveryCc ||
      this.supportedCountries.resolveUserTaxCountryCode(user, deliveryCc);
    const taxBaseDisplay = goodsDisplay + shippingDisplay;
    const taxBreakdown = await this.supportedCountries.computeTaxesForModule({
      countryCode: taxCountry,
      baseAmount: taxBaseDisplay,
      module: 'order',
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

    const goodsCents = displayToMinor(goodsDisplay, amountFactor);
    const shipCents = displayToMinor(shippingDisplay, amountFactor);
    const orderGrossCents = goodsCents + shipCents;
    // Split commission avec stratégie par ligne (reverse markup si add_to_price).
    const commissionSplit =
      await this.planOrderCommission.computeVendorTransferSplitForStore(
        storeId,
        {
          goodsCents,
          shipCents,
          lineItems: lines.map((line) => ({
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotalMinor: displayToMinor(line.lineTotal, amountFactor),
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

    const commissionSettings =
      await this.planOrderCommission.resolveOrderCommissionForStore(storeId);

    return {
      storeId,
      storeName: String(store.name ?? ''),
      currency,
      fulfillmentMode: mode,
      customerAddressLabel: String(dto.customerAddressLabel ?? '').trim() || null,
      lines,
      customer: {
        goods: goodsDisplay,
        shipping: shippingDisplay,
        shippingMeta,
        taxes: taxBreakdown,
        taxTotal: taxBreakdown.taxTotal,
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
        netTransfer: minorToDisplay(vendorNetCents, amountFactor),
        note:
          mode === CartSimulatorFulfillmentMode.DELIVERY
            ? 'La livraison et le pourboire sont payés par le client mais ne sont pas versés au vendeur.'
            : undefined,
      },
      disclaimer:
        'Simulation indicative — sans coupon, code cadeau ni frais Stripe Connect.',
    };
  }
}
