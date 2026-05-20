import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformFeeMode,
  PlatformFeesSettingsDocument,
  PlatformFeesSettingsModel,
} from '@schemas/platform-fees-settings.schema';
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

@Injectable()
export class PlatformFeesService {
  constructor(
    @InjectModel(PlatformFeesSettingsModel.name)
    private readonly _model: Model<PlatformFeesSettingsDocument>,
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

  async getSettings(user: UserModel) {
    assertAdmin(user);
    const doc = await this._ensureDoc();
    return this._toResponse(doc);
  }

  async updateSettings(user: UserModel, dto: UpdatePlatformFeesDto) {
    assertAdmin(user);
    const current = await this._ensureDoc();
    const $set: Record<string, unknown> = {};

    if (dto.currency != null) {
      $set.currency = String(dto.currency).trim().toUpperCase() || 'CAD';
    }

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

    $set.refundFeeMode = refundFeeMode;
    $set.orderPaymentFeeMode = orderPaymentFeeMode;
    $set.mlmCommissionMode = mlmCommissionMode;
    $set.platformOrderFeeMode = platformOrderFeeMode;

    const refundFeeFixed =
      dto.refundFeeFixed ?? current.refundFeeFixed ?? 0;
    const refundFeePercent =
      dto.refundFeePercent ?? current.refundFeePercent ?? 0;
    $set.refundFeeFixed =
      refundFeeMode === 'fixed' ? refundFeeFixed : 0;
    $set.refundFeePercent =
      refundFeeMode === 'percent' ? refundFeePercent : 0;

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

    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
