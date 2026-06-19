import { CartService } from '@modules/cart/cart.service';
import { PlatformShippingQuoteService } from '@modules/platform-shipping-settings/platform-shipping-quote.service';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import {
  allocateDeliveryTipCents,
  DELIVERY_TIP_ALLOCATION_BY_SHIPPING_FEE,
  maxDeliveryTipCentsForGoodsSubtotal,
} from './delivery-tip-allocation.util';
import { DeliveryTipPreviewDto } from './dto/delivery-tip-preview.dto';

type CartGroup = {
  store: {
    _id?: unknown;
    id?: string;
    name?: string;
    supportsShipping?: boolean;
  };
  items: unknown[];
  totalPrice: number;
};

export type DeliveryTipPresetOption = {
  cents: number;
  kind: 'fixed' | 'percent';
  value: number;
  label: string;
};

type TipSettings = {
  deliveryTipMode: string;
  deliveryTipFixed: number;
  deliveryTipPercent: number;
  deliveryTipPresets?: number[];
  deliveryTipFixedPresets?: number[];
  deliveryTipPercentPresets?: number[];
};

function storeMongoId(store: CartGroup['store']): string {
  const raw = store?._id ?? store?.id;
  if (raw == null) return '';
  if (typeof raw === 'object' && raw !== null && '_id' in raw) {
    return String((raw as { _id: unknown })._id);
  }
  return String(raw);
}

function formatPercentLabel(value: number): string {
  return `${value % 1 === 0 ? value : value.toFixed(1)} %`;
}

function formatFixedLabel(value: number, currency: string): string {
  const amount = Math.max(0, value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export type DeliveryTipLegQuote = {
  storeId: string;
  storeName: string;
  fulfillment: 'delivery' | 'pickup';
  deliverable: boolean;
  distanceKm: number | null;
  shippingFeeCents: number;
  goodsSubtotalCents: number;
};

@Injectable()
export class DeliveryTipService {
  constructor(
    private readonly cartService: CartService,
    private readonly quoteService: PlatformShippingQuoteService,
    private readonly shippingSettings: PlatformShippingSettingsService,
  ) {}

  async resolveDeliveryLegs(
    user: UserModel,
    fulfillmentByStoreId: Record<string, string>,
    addressId?: string,
    coupons?: Array<{ storeId: string; code: string }>,
  ): Promise<{
    legs: DeliveryTipLegQuote[];
    pickupStoreIds: string[];
    deliveryGoodsSubtotalCents: number;
  }> {
    const cart = await this.cartService.filter(user);
    const groups = (cart?.data ?? []) as CartGroup[];
    const couponByStore = new Map(
      (coupons ?? [])
        .filter((c) => c.storeId?.trim() && c.code?.trim())
        .map((c) => [c.storeId.trim(), c.code.trim()] as const),
    );
    const legs: DeliveryTipLegQuote[] = [];
    const pickupStoreIds: string[] = [];
    let deliveryGoodsSubtotalCents = 0;

    for (const g of groups) {
      const storeId = storeMongoId(g.store);
      if (!storeId) continue;

      const modeRaw = fulfillmentByStoreId[storeId] ?? 'pickup';
      const mode = modeRaw === 'delivery' ? 'delivery' : 'pickup';
      const storeName = String(g.store?.name ?? 'Restaurant');
      const goodsSubtotalCents = await this._deliveryGoodsSubtotalCentsForStore(
        user,
        storeId,
        g,
        couponByStore.get(storeId),
      );

      if (mode !== 'delivery' || !g.store?.supportsShipping) {
        if (mode === 'pickup') pickupStoreIds.push(storeId);
        continue;
      }

      deliveryGoodsSubtotalCents += goodsSubtotalCents;

      if (!addressId?.trim()) {
        throw new BadRequestException('address_required');
      }

      const q = await this.quoteService.quoteForUser(user, {
        storeId,
        addressId: addressId.trim(),
      });

      if (!q.deliverable || q.fee == null) {
        throw new BadRequestException({
          message: 'delivery_not_available',
          storeId,
          distanceKm: q.distanceKm,
          maxDeliveryRadiusKm: q.maxDeliveryRadiusKm,
        });
      }

      legs.push({
        storeId,
        storeName,
        fulfillment: 'delivery',
        deliverable: true,
        distanceKm: q.distanceKm,
        shippingFeeCents: Math.round(q.fee * 100 + Number.EPSILON),
        goodsSubtotalCents,
      });
    }

    return { legs, pickupStoreIds, deliveryGoodsSubtotalCents };
  }

  assertTipAmountAllowed(
    tipTotalCents: number,
    deliveryGoodsSubtotalCents: number,
    enabled: boolean,
    allowedPresetCents: number[] = [],
  ): void {
    const tip = Math.max(0, Math.round(tipTotalCents));
    if (tip < 1) return;
    if (!enabled) {
      throw new BadRequestException('delivery_tip_disabled');
    }
    if (deliveryGoodsSubtotalCents < 1) {
      throw new BadRequestException('invalid_tip_amount');
    }
    const presetSet = new Set(
      allowedPresetCents
        .map((c) => Math.max(0, Math.round(c)))
        .filter((c) => c >= 1),
    );
    if (presetSet.has(tip)) return;

    const maxTip = maxDeliveryTipCentsForGoodsSubtotal(deliveryGoodsSubtotalCents);
    if (tip > maxTip) {
      throw new BadRequestException({
        message: 'invalid_tip_amount',
        maxTipCents: maxTip,
      });
    }
  }

  private async _deliveryGoodsSubtotalCentsForStore(
    user: UserModel,
    storeId: string,
    group: CartGroup,
    couponCode?: string,
  ): Promise<number> {
    const grossCents = Math.round(
      (Number(group.totalPrice) || 0) * 100 + Number.EPSILON,
    );
    const code = couponCode?.trim();
    if (!code) return grossCents;
    try {
      const snap = await this.cartService.previewCouponForStore(
        user,
        storeId,
        code,
      );
      return Math.round(snap.totalAfterDiscount * 100 + Number.EPSILON);
    } catch {
      return grossCents;
    }
  }

  resolveTipPresetLists(settings: TipSettings): {
    fixedPresets: number[];
    percentPresets: number[];
  } {
    let fixedPresets = (settings.deliveryTipFixedPresets ?? []).filter(
      (v) => Number.isFinite(v) && v >= 0,
    );
    let percentPresets = (settings.deliveryTipPercentPresets ?? []).filter(
      (v) => Number.isFinite(v) && v >= 0,
    );

    if (!fixedPresets.length && !percentPresets.length) {
      const legacy = (settings.deliveryTipPresets ?? []).filter(
        (v) => Number.isFinite(v) && v >= 0,
      );
      if (settings.deliveryTipMode === 'percent') {
        percentPresets = legacy.length
          ? legacy
          : settings.deliveryTipPercent > 0
            ? [settings.deliveryTipPercent]
            : [];
      } else {
        fixedPresets = legacy.length
          ? legacy
          : settings.deliveryTipFixed > 0
            ? [settings.deliveryTipFixed]
            : [];
      }
    }

    return { fixedPresets, percentPresets };
  }

  tipPresetOptions(
    settings: TipSettings,
    deliveryGoodsSubtotalCents: number,
    currency: string,
  ): DeliveryTipPresetOption[] {
    const { fixedPresets, percentPresets } =
      this.resolveTipPresetLists(settings);
    const options: DeliveryTipPresetOption[] = [];

    for (const value of fixedPresets) {
      const cents = Math.round(Math.max(0, value) * 100);
      if (cents <= 0) continue;
      options.push({
        cents,
        kind: 'fixed',
        value,
        label: formatFixedLabel(value, currency),
      });
    }

    for (const value of percentPresets) {
      const cents = Math.round(
        (deliveryGoodsSubtotalCents * Math.max(0, value)) / 100,
      );
      if (cents <= 0) continue;
      options.push({
        cents,
        kind: 'percent',
        value,
        label: formatPercentLabel(value),
      });
    }

    options.sort((a, b) => a.cents - b.cents || a.kind.localeCompare(b.kind));
    const seen = new Set<string>();
    return options.filter((option) => {
      const key = `${option.kind}:${option.value.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  tipPresetCents(
    settings: TipSettings,
    deliveryGoodsSubtotalCents: number,
    currency: string,
  ): number[] {
    return this.tipPresetOptions(
      settings,
      deliveryGoodsSubtotalCents,
      currency,
    ).map((option) => option.cents);
  }

  suggestedTipCents(
    settings: TipSettings,
    deliveryGoodsSubtotalCents: number,
    currency: string,
  ): number {
    const presets = this.tipPresetCents(
      settings,
      deliveryGoodsSubtotalCents,
      currency,
    );
    return presets[0] ?? 0;
  }

  async preview(user: UserModel, dto: DeliveryTipPreviewDto) {
    const regionCode = String(user.appCountryCode ?? '')
      .trim()
      .toUpperCase();
    const settings = await this.shippingSettings.getPublicSettings(
      regionCode || undefined,
    );
    const tipTotalCents = Math.max(0, Math.round(dto.deliveryTipTotalCents));

    const coupons = (dto.coupons ?? [])
      .filter((c) => c.storeId?.trim() && c.code?.trim())
      .map((c) => ({ storeId: c.storeId.trim(), code: c.code.trim() }));

    const { legs, pickupStoreIds, deliveryGoodsSubtotalCents } =
      await this.resolveDeliveryLegs(
        user,
        dto.fulfillmentByStoreId ?? {},
        dto.addressId,
        coupons,
      );

    const tipPresetOptions = this.tipPresetOptions(
      settings,
      deliveryGoodsSubtotalCents,
      settings.currency,
    );

    this.assertTipAmountAllowed(
      tipTotalCents,
      deliveryGoodsSubtotalCents,
      settings.deliveryTipEnabled,
      tipPresetOptions.map((option) => option.cents),
    );

    const allocated = allocateDeliveryTipCents({
      tipTotalCents,
      legs: legs.map((l) => ({
        storeId: l.storeId,
        shipCents: l.shippingFeeCents,
      })),
    });

    const allocationPreview = legs.map((leg) => {
      const row = allocated.find((a) => a.storeId === leg.storeId);
      return {
        storeId: leg.storeId,
        storeName: leg.storeName,
        fulfillment: leg.fulfillment,
        deliverable: leg.deliverable,
        distanceKm: leg.distanceKm,
        shippingFeeCents: leg.shippingFeeCents,
        shippingWeight: row?.shippingWeight ?? 0,
        allocatedTipCents: row?.allocatedTipCents ?? 0,
      };
    });

    return {
      enabled: settings.deliveryTipEnabled,
      currency: settings.currency,
      deliveryTipTotalCents: tipTotalCents,
      allocationMethod: DELIVERY_TIP_ALLOCATION_BY_SHIPPING_FEE,
      deliveryLegCount: legs.length,
      suggestedTipCents: this.suggestedTipCents(
        settings,
        deliveryGoodsSubtotalCents,
        settings.currency,
      ),
      tipPresetCents: tipPresetOptions.map((option) => option.cents),
      tipPresetOptions,
      allocationPreview,
      pickupStoresSkipped: pickupStoreIds,
      warnings: [] as string[],
    };
  }

  allocateForCheckout(params: {
    tipTotalCents: number;
    legs: Array<{ storeId: string; shipCents: number }>;
  }): Record<string, number> {
    const rows = allocateDeliveryTipCents(params);
    const out: Record<string, number> = {};
    for (const row of rows) {
      out[row.storeId] = row.allocatedTipCents;
    }
    return out;
  }

  async resolveCheckoutTipAllocation(
    user: UserModel,
    params: {
      fulfillmentByStoreId: Record<string, string>;
      addressId?: string;
      deliveryTipTotalCents: number;
      coupons?: Array<{ storeId: string; code: string }>;
    },
  ): Promise<{
    deliveryTipTotalCents: number;
    tipCentsByStore: Record<string, number>;
    allocationMethod: string;
  }> {
    const tipTotalCents = Math.max(
      0,
      Math.round(params.deliveryTipTotalCents),
    );
    if (tipTotalCents < 1) {
      return {
        deliveryTipTotalCents: 0,
        tipCentsByStore: {},
        allocationMethod: DELIVERY_TIP_ALLOCATION_BY_SHIPPING_FEE,
      };
    }

    const settings = await this.shippingSettings.getPublicSettings(
      String(user.appCountryCode ?? '').trim().toUpperCase() || undefined,
    );
    const coupons = (params.coupons ?? [])
      .filter((c) => c.storeId?.trim() && c.code?.trim())
      .map((c) => ({ storeId: c.storeId.trim(), code: c.code.trim() }));

    const { legs, deliveryGoodsSubtotalCents } = await this.resolveDeliveryLegs(
      user,
      params.fulfillmentByStoreId,
      params.addressId,
      coupons,
    );

    const tipPresetOptions = this.tipPresetOptions(
      settings,
      deliveryGoodsSubtotalCents,
      settings.currency,
    );

    this.assertTipAmountAllowed(
      tipTotalCents,
      deliveryGoodsSubtotalCents,
      settings.deliveryTipEnabled,
      tipPresetOptions.map((option) => option.cents),
    );

    return {
      deliveryTipTotalCents: tipTotalCents,
      tipCentsByStore: this.allocateForCheckout({
        tipTotalCents,
        legs: legs.map((l) => ({
          storeId: l.storeId,
          shipCents: l.shippingFeeCents,
        })),
      }),
      allocationMethod: DELIVERY_TIP_ALLOCATION_BY_SHIPPING_FEE,
    };
  }
}
