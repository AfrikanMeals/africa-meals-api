import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { toStripeMinorUnits } from '../../utils/stripe-currency-amount.util';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformFeeMode,
  PlatformFeesSettingsDocument,
  PlatformFeesSettingsModel,
} from '@schemas/platform-fees-settings.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdatePlatformFeesDto } from './dto/update-platform-fees.dto';

const SETTINGS_KEY = 'default';

const DEFAULTS = {
  currency: 'CAD',
  refundFeeMode: 'fixed' as PlatformFeeMode,
  refundFeeFixed: 0,
  refundFeePercent: 0,
  orderPaymentFeeMode: 'fixed' as PlatformFeeMode,
  orderPaymentFeeFixed: 0,
  orderPaymentFeePercent: 0,
  mlmCommissionMode: 'percent' as PlatformFeeMode,
  mlmCommissionFixed: 0,
  mlmCommissionPercent: 0,
  mlmCommissionCapPerOrder: 0,
  platformOrderFeeMode: 'fixed' as PlatformFeeMode,
  platformOrderFeeFixed: 0,
  platformOrderFeePercent: 0,
  payoutFeeMode: 'fixed' as PlatformFeeMode,
  payoutFeeFixed: 0,
  payoutFeePercent: 0,
};

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function normalizeMode(
  raw: string | undefined,
  fallback: PlatformFeeMode,
): PlatformFeeMode {
  return raw === 'percent' || raw === 'fixed' ? raw : fallback;
}

function inferMode(
  stored: string | undefined,
  fixed: number,
  percent: number,
  fallback: PlatformFeeMode,
): PlatformFeeMode {
  if (stored === 'percent' || stored === 'fixed') return stored;
  if (percent > 0 && fixed <= 0) return 'percent';
  if (fixed > 0 && percent <= 0) return 'fixed';
  return fallback;
}

/** Frais de transaction sur le montant commande (ajoutés au total client). */
export type OrderPaymentFeeSplit = {
  grossCents: number;
  platformFeeCents: number;
  totalCents: number;
  feeMode: PlatformFeeMode;
  feePercent: number;
  feeFixedCad: number;
};

/** Répartition d’un remboursement : brut payé, frais plateforme, net client. */
export type RefundAmountSplit = {
  grossCents: number;
  platformFeeCents: number;
  customerRefundCents: number;
  feeMode: PlatformFeeMode;
  feePercent: number;
  feeFixedCad: number;
};

/** Répartition commande : brut encaissé, commission plateforme, net à transférer au vendeur. */
export type VendorTransferSplit = {
  grossCents: number;
  platformFeeCents: number;
  transferCents: number;
  feeMode: PlatformFeeMode;
  feePercent: number;
  feeFixedCad: number;
};

/** Répartition versement : brut disponible, frais payout, net versé au vendeur. */
export type PayoutFeeSplit = {
  grossCents: number;
  platformFeeCents: number;
  payoutCents: number;
  feeMode: PlatformFeeMode;
  feePercent: number;
  feeFixedCad: number;
};

export function computeVendorTransferSplit(
  grossCents: number,
  settings: {
    platformOrderFeeMode: PlatformFeeMode;
    platformOrderFeeFixed: number;
    platformOrderFeePercent: number;
  },
): VendorTransferSplit {
  const gross = Math.max(0, Math.round(grossCents));
  const feeMode = settings.platformOrderFeeMode;
  const feePercent = Math.max(0, settings.platformOrderFeePercent ?? 0);
  const feeFixedCad = Math.max(0, settings.platformOrderFeeFixed ?? 0);

  if (gross < 1) {
    return {
      grossCents: 0,
      platformFeeCents: 0,
      transferCents: 0,
      feeMode,
      feePercent,
      feeFixedCad,
    };
  }

  let platformFeeCents =
    feeMode === 'percent'
      ? Math.round(gross * (feePercent / 100))
      : Math.round(feeFixedCad * 100);

  platformFeeCents = Math.max(0, Math.min(platformFeeCents, gross));
  const transferCents = gross - platformFeeCents;

  return {
    grossCents: gross,
    platformFeeCents,
    transferCents,
    feeMode,
    feePercent,
    feeFixedCad,
  };
}

export function computePayoutFeeSplit(
  grossCents: number,
  settings: {
    payoutFeeMode: PlatformFeeMode;
    payoutFeeFixed: number;
    payoutFeePercent: number;
  },
): PayoutFeeSplit {
  const gross = Math.max(0, Math.round(grossCents));
  const feeMode = settings.payoutFeeMode;
  const feePercent = Math.max(0, settings.payoutFeePercent ?? 0);
  const feeFixedCad = Math.max(0, settings.payoutFeeFixed ?? 0);

  if (gross < 1) {
    return {
      grossCents: 0,
      platformFeeCents: 0,
      payoutCents: 0,
      feeMode,
      feePercent,
      feeFixedCad,
    };
  }

  let platformFeeCents =
    feeMode === 'percent'
      ? Math.round(gross * (feePercent / 100))
      : Math.round(feeFixedCad * 100);

  platformFeeCents = Math.max(0, Math.min(platformFeeCents, gross));

  return {
    grossCents: gross,
    platformFeeCents,
    payoutCents: gross - platformFeeCents,
    feeMode,
    feePercent,
    feeFixedCad,
  };
}

export function computeOrderPaymentFeeSplit(
  grossCents: number,
  settings: {
    orderPaymentFeeMode: PlatformFeeMode;
    orderPaymentFeeFixed: number;
    orderPaymentFeePercent: number;
  },
  currency = 'CAD',
): OrderPaymentFeeSplit {
  const gross = Math.max(0, Math.round(grossCents));
  const feeMode = settings.orderPaymentFeeMode;
  const feePercent = Math.max(0, settings.orderPaymentFeePercent ?? 0);
  const feeFixedCad = Math.max(0, settings.orderPaymentFeeFixed ?? 0);

  if (gross < 1) {
    return {
      grossCents: 0,
      platformFeeCents: 0,
      totalCents: 0,
      feeMode,
      feePercent,
      feeFixedCad,
    };
  }

  const platformFeeCents =
    feeMode === 'percent'
      ? Math.round(gross * (feePercent / 100))
      : toStripeMinorUnits(feeFixedCad, currency);

  const fee = Math.max(0, platformFeeCents);

  return {
    grossCents: gross,
    platformFeeCents: fee,
    totalCents: gross + fee,
    feeMode,
    feePercent,
    feeFixedCad,
  };
}

export function computeRefundAmountSplit(
  grossCents: number,
  settings: {
    refundFeeMode: PlatformFeeMode;
    refundFeeFixed: number;
    refundFeePercent: number;
  },
): RefundAmountSplit {
  const gross = Math.max(0, Math.round(grossCents));
  const feeMode = settings.refundFeeMode;
  const feePercent = Math.max(0, settings.refundFeePercent ?? 0);
  const feeFixedCad = Math.max(0, settings.refundFeeFixed ?? 0);

  if (gross < 1) {
    return {
      grossCents: 0,
      platformFeeCents: 0,
      customerRefundCents: 0,
      feeMode,
      feePercent,
      feeFixedCad,
    };
  }

  let platformFeeCents =
    feeMode === 'percent'
      ? Math.round(gross * (feePercent / 100))
      : Math.round(feeFixedCad * 100);

  platformFeeCents = Math.max(0, Math.min(platformFeeCents, gross - 1));
  const customerRefundCents = gross - platformFeeCents;

  return {
    grossCents: gross,
    platformFeeCents,
    customerRefundCents,
    feeMode,
    feePercent,
    feeFixedCad,
  };
}

@Injectable()
export class PlatformFeesService {
  constructor(
    private readonly _supportedCountries: SupportedCountriesService,
    @InjectModel(PlatformFeesSettingsModel.name)
    private readonly _model: Model<PlatformFeesSettingsDocument>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
  ) {}

  private _toResponse(doc: PlatformFeesSettingsModel) {
    const refundFeeMode = inferMode(
      doc.refundFeeMode,
      doc.refundFeeFixed ?? 0,
      doc.refundFeePercent ?? 0,
      DEFAULTS.refundFeeMode,
    );
    const orderPaymentFeeMode = inferMode(
      doc.orderPaymentFeeMode,
      doc.orderPaymentFeeFixed ?? 0,
      doc.orderPaymentFeePercent ?? 0,
      DEFAULTS.orderPaymentFeeMode,
    );
    const mlmCommissionMode = inferMode(
      doc.mlmCommissionMode,
      doc.mlmCommissionFixed ?? 0,
      doc.mlmCommissionPercent ?? 0,
      DEFAULTS.mlmCommissionMode,
    );
    const platformOrderFeeMode = inferMode(
      doc.platformOrderFeeMode,
      doc.platformOrderFeeFixed ?? 0,
      doc.platformOrderFeePercent ?? 0,
      DEFAULTS.platformOrderFeeMode,
    );
    const payoutFeeMode = inferMode(
      doc.payoutFeeMode,
      doc.payoutFeeFixed ?? 0,
      doc.payoutFeePercent ?? 0,
      DEFAULTS.payoutFeeMode,
    );

    return {
      currency: doc.currency ?? DEFAULTS.currency,
      refundFeeMode,
      refundFeeFixed: doc.refundFeeFixed ?? 0,
      refundFeePercent: doc.refundFeePercent ?? 0,
      orderPaymentFeeMode,
      orderPaymentFeeFixed: doc.orderPaymentFeeFixed ?? 0,
      orderPaymentFeePercent: doc.orderPaymentFeePercent ?? 0,
      mlmCommissionMode,
      mlmCommissionFixed: doc.mlmCommissionFixed ?? 0,
      mlmCommissionPercent: doc.mlmCommissionPercent ?? 0,
      mlmCommissionCapPerOrder: doc.mlmCommissionCapPerOrder ?? 0,
      platformOrderFeeMode,
      platformOrderFeeFixed: doc.platformOrderFeeFixed ?? 0,
      platformOrderFeePercent: doc.platformOrderFeePercent ?? 0,
      payoutFeeMode,
      payoutFeeFixed: doc.payoutFeeFixed ?? 0,
      payoutFeePercent: doc.payoutFeePercent ?? 0,
      updatedAt:
        (doc as unknown as { updatedAt?: Date }).updatedAt?.toISOString?.() ??
        null,
    };
  }

  private async _ensureDoc(): Promise<PlatformFeesSettingsModel> {
    const doc = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $setOnInsert: { key: SETTINGS_KEY, ...DEFAULTS } },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as PlatformFeesSettingsModel;
  }

  private async _resolveCurrencyFromStoreSettings(): Promise<string> {
    const store = await this._storeModel
      .findOne({
        currency: { $exists: true, $type: 'string', $ne: '' },
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select('currency')
      .lean()
      .exec();
    const cur = String(store?.currency ?? '')
      .trim()
      .toUpperCase();
    return cur || DEFAULTS.currency;
  }

  async getSettings(user: UserModel) {
    assertAdmin(user);
    const doc = await this._ensureDoc();
    const storeCurrency = await this._resolveCurrencyFromStoreSettings();
    return {
      ...this._toResponse(doc),
      currency: storeCurrency,
    };
  }

  /** Commission plateforme + montant à transférer au vendeur Connect. */
  async computeVendorTransferSplitFromSettings(
    grossCents: number,
  ): Promise<VendorTransferSplit> {
    const doc = await this._ensureDoc();
    const settings = this._toResponse(doc);
    return computeVendorTransferSplit(grossCents, {
      platformOrderFeeMode: settings.platformOrderFeeMode,
      platformOrderFeeFixed: settings.platformOrderFeeFixed,
      platformOrderFeePercent: settings.platformOrderFeePercent,
    });
  }

  /** Frais appliqués lors d'un versement manuel vendeur (request payout). */
  async computePayoutFeeFromSettings(
    grossCents: number,
  ): Promise<PayoutFeeSplit> {
    const doc = await this._ensureDoc();
    const settings = this._toResponse(doc);
    return computePayoutFeeSplit(grossCents, {
      payoutFeeMode: settings.payoutFeeMode,
      payoutFeeFixed: settings.payoutFeeFixed,
      payoutFeePercent: settings.payoutFeePercent,
    });
  }

  /** Barème remboursement (sans auth) — utilisé par le traitement des remboursements. */
  async computeRefundSplit(grossCents: number): Promise<RefundAmountSplit> {
    const doc = await this._ensureDoc();
    const settings = this._toResponse(doc);
    return computeRefundAmountSplit(grossCents, {
      refundFeeMode: settings.refundFeeMode,
      refundFeeFixed: settings.refundFeeFixed,
      refundFeePercent: settings.refundFeePercent,
    });
  }

  /** Barème frais de transaction commande (apps mobile / checkout). */
  async getPublicCheckoutFees() {
    const doc = await this._ensureDoc();
    const settings = this._toResponse(doc);
    const currency = await this._supportedCountries.getPrimaryBillingCurrency();
    return {
      currency,
      orderPaymentFeeMode: settings.orderPaymentFeeMode,
      orderPaymentFeeFixed: settings.orderPaymentFeeFixed,
      orderPaymentFeePercent: settings.orderPaymentFeePercent,
    };
  }

  /** Barèmes publics pour la page tarifs du site vitrine. */
  async getPublicPricingFees() {
    const doc = await this._ensureDoc();
    const settings = this._toResponse(doc);
    const currency = await this._supportedCountries.getPrimaryBillingCurrency();
    return {
      currency,
      orderPaymentFeeMode: settings.orderPaymentFeeMode,
      orderPaymentFeeFixed: settings.orderPaymentFeeFixed,
      orderPaymentFeePercent: settings.orderPaymentFeePercent,
      refundFeeMode: settings.refundFeeMode,
      refundFeeFixed: settings.refundFeeFixed,
      refundFeePercent: settings.refundFeePercent,
      platformOrderFeeMode: settings.platformOrderFeeMode,
      platformOrderFeeFixed: settings.platformOrderFeeFixed,
      platformOrderFeePercent: settings.platformOrderFeePercent,
      payoutFeeMode: settings.payoutFeeMode,
      payoutFeeFixed: settings.payoutFeeFixed,
      payoutFeePercent: settings.payoutFeePercent,
      updatedAt: settings.updatedAt,
    };
  }

  async computeOrderPaymentFeeFromSettings(
    grossCents: number,
    currency = 'CAD',
  ): Promise<OrderPaymentFeeSplit> {
    const doc = await this._ensureDoc();
    const settings = this._toResponse(doc);
    return computeOrderPaymentFeeSplit(
      grossCents,
      {
        orderPaymentFeeMode: settings.orderPaymentFeeMode,
        orderPaymentFeeFixed: settings.orderPaymentFeeFixed,
        orderPaymentFeePercent: settings.orderPaymentFeePercent,
      },
      currency,
    );
  }

  async updateSettings(user: UserModel, dto: UpdatePlatformFeesDto) {
    assertAdmin(user);
    const current = await this._ensureDoc();
    const $set: Record<string, unknown> = {};

    const refundFeeMode = normalizeMode(
      dto.refundFeeMode,
      inferMode(
        current.refundFeeMode,
        current.refundFeeFixed ?? 0,
        current.refundFeePercent ?? 0,
        DEFAULTS.refundFeeMode,
      ),
    );
    const orderPaymentFeeMode = normalizeMode(
      dto.orderPaymentFeeMode,
      inferMode(
        current.orderPaymentFeeMode,
        current.orderPaymentFeeFixed ?? 0,
        current.orderPaymentFeePercent ?? 0,
        DEFAULTS.orderPaymentFeeMode,
      ),
    );
    const mlmCommissionMode = normalizeMode(
      dto.mlmCommissionMode,
      inferMode(
        current.mlmCommissionMode,
        current.mlmCommissionFixed ?? 0,
        current.mlmCommissionPercent ?? 0,
        DEFAULTS.mlmCommissionMode,
      ),
    );
    const platformOrderFeeMode = normalizeMode(
      dto.platformOrderFeeMode,
      inferMode(
        current.platformOrderFeeMode,
        current.platformOrderFeeFixed ?? 0,
        current.platformOrderFeePercent ?? 0,
        DEFAULTS.platformOrderFeeMode,
      ),
    );
    const payoutFeeMode = normalizeMode(
      dto.payoutFeeMode,
      inferMode(
        current.payoutFeeMode,
        current.payoutFeeFixed ?? 0,
        current.payoutFeePercent ?? 0,
        DEFAULTS.payoutFeeMode,
      ),
    );

    $set.refundFeeMode = refundFeeMode;
    $set.orderPaymentFeeMode = orderPaymentFeeMode;
    $set.mlmCommissionMode = mlmCommissionMode;
    $set.platformOrderFeeMode = platformOrderFeeMode;
    $set.payoutFeeMode = payoutFeeMode;

    const refundFeeFixed = dto.refundFeeFixed ?? current.refundFeeFixed ?? 0;
    const refundFeePercent =
      dto.refundFeePercent ?? current.refundFeePercent ?? 0;
    $set.refundFeeFixed = refundFeeMode === 'fixed' ? refundFeeFixed : 0;
    $set.refundFeePercent = refundFeeMode === 'percent' ? refundFeePercent : 0;

    const orderPaymentFeeFixed =
      dto.orderPaymentFeeFixed ?? current.orderPaymentFeeFixed ?? 0;
    const orderPaymentFeePercent =
      dto.orderPaymentFeePercent ?? current.orderPaymentFeePercent ?? 0;
    $set.orderPaymentFeeFixed =
      orderPaymentFeeMode === 'fixed' ? orderPaymentFeeFixed : 0;
    $set.orderPaymentFeePercent =
      orderPaymentFeeMode === 'percent' ? orderPaymentFeePercent : 0;

    const mlmCommissionFixed =
      dto.mlmCommissionFixed ?? current.mlmCommissionFixed ?? 0;
    const mlmCommissionPercent =
      dto.mlmCommissionPercent ?? current.mlmCommissionPercent ?? 0;
    $set.mlmCommissionFixed =
      mlmCommissionMode === 'fixed' ? mlmCommissionFixed : 0;
    $set.mlmCommissionPercent =
      mlmCommissionMode === 'percent' ? mlmCommissionPercent : 0;

    if (dto.mlmCommissionCapPerOrder !== undefined) {
      $set.mlmCommissionCapPerOrder = dto.mlmCommissionCapPerOrder;
    }

    const platformOrderFeeFixed =
      dto.platformOrderFeeFixed ?? current.platformOrderFeeFixed ?? 0;
    const platformOrderFeePercent =
      dto.platformOrderFeePercent ?? current.platformOrderFeePercent ?? 0;
    $set.platformOrderFeeFixed =
      platformOrderFeeMode === 'fixed' ? platformOrderFeeFixed : 0;
    $set.platformOrderFeePercent =
      platformOrderFeeMode === 'percent' ? platformOrderFeePercent : 0;

    const payoutFeeFixed = dto.payoutFeeFixed ?? current.payoutFeeFixed ?? 0;
    const payoutFeePercent =
      dto.payoutFeePercent ?? current.payoutFeePercent ?? 0;
    $set.payoutFeeFixed = payoutFeeMode === 'fixed' ? payoutFeeFixed : 0;
    $set.payoutFeePercent = payoutFeeMode === 'percent' ? payoutFeePercent : 0;

    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    const storeCurrency = await this._resolveCurrencyFromStoreSettings();
    return {
      ...this._toResponse(updated),
      currency: storeCurrency,
    };
  }
}
