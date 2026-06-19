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

function storeMongoId(store: CartGroup['store']): string {
  const raw = store?._id ?? store?.id;
  if (raw == null) return '';
  if (typeof raw === 'object' && raw !== null && '_id' in raw) {
    return String((raw as { _id: unknown })._id);
  }
  return String(raw);
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
  ): Promise<{
    legs: DeliveryTipLegQuote[];
    pickupStoreIds: string[];
    deliveryGoodsSubtotalCents: number;
  }> {
    const cart = await this.cartService.filter(user);
    const groups = (cart?.data ?? []) as CartGroup[];
    const legs: DeliveryTipLegQuote[] = [];
    const pickupStoreIds: string[] = [];
    let deliveryGoodsSubtotalCents = 0;

    for (const g of groups) {
      const storeId = storeMongoId(g.store);
      if (!storeId) continue;

      const modeRaw = fulfillmentByStoreId[storeId] ?? 'pickup';
      const mode = modeRaw === 'delivery' ? 'delivery' : 'pickup';
      const storeName = String(g.store?.name ?? 'Restaurant');
      const goodsSubtotalCents = Math.round(
        (Number(g.totalPrice) || 0) * 100 + Number.EPSILON,
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
  ): void {
    const tip = Math.max(0, Math.round(tipTotalCents));
    if (tip < 1) return;
    if (!enabled) {
      throw new BadRequestException('delivery_tip_disabled');
    }
    const maxTip = maxDeliveryTipCentsForGoodsSubtotal(deliveryGoodsSubtotalCents);
    if (tip > maxTip) {
      throw new BadRequestException({
        message: 'invalid_tip_amount',
        maxTipCents: maxTip,
      });
    }
  }

  async preview(user: UserModel, dto: DeliveryTipPreviewDto) {
    const settings = await this.shippingSettings.getPublicSettings();
    const tipTotalCents = Math.max(0, Math.round(dto.deliveryTipTotalCents));

    const { legs, pickupStoreIds, deliveryGoodsSubtotalCents } =
      await this.resolveDeliveryLegs(
        user,
        dto.fulfillmentByStoreId ?? {},
        dto.addressId,
      );

    this.assertTipAmountAllowed(
      tipTotalCents,
      deliveryGoodsSubtotalCents,
      settings.deliveryTipEnabled,
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
      ),
      allocationPreview,
      pickupStoresSkipped: pickupStoreIds,
      warnings: [] as string[],
    };
  }

  suggestedTipCents(
    settings: {
      deliveryTipMode: string;
      deliveryTipFixed: number;
      deliveryTipPercent: number;
    },
    deliveryGoodsSubtotalCents: number,
  ): number {
    if (settings.deliveryTipMode === 'percent') {
      const pct = Math.max(0, Number(settings.deliveryTipPercent) || 0);
      return Math.round((deliveryGoodsSubtotalCents * pct) / 100);
    }
    return Math.round((Math.max(0, Number(settings.deliveryTipFixed) || 0)) * 100);
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

    const settings = await this.shippingSettings.getPublicSettings();
    const { legs, deliveryGoodsSubtotalCents } = await this.resolveDeliveryLegs(
      user,
      params.fulfillmentByStoreId,
      params.addressId,
    );
    this.assertTipAmountAllowed(
      tipTotalCents,
      deliveryGoodsSubtotalCents,
      settings.deliveryTipEnabled,
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
