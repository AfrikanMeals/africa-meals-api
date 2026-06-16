import { setPartnerBadgeDefinitionsCache } from '@common/partner-badges/partner-badge.cache';
import { StripeConnectService } from '@modules/billing/stripe/stripe-connect.service';
import {
  isPartnerBadgeCode,
  listPartnerBadgeDefinitions,
  PartnerBadgeCode,
  type PartnerBadgeDefinition,
} from '@common/partner-badges/partner-badge.constants';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PartnerBadgeModel } from '@schemas/partner-badge.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { DEFAULT_PARTNER_BADGE_SEEDS } from './partner-badge.seed';
import { UpdatePartnerBadgeDto } from './dto/update-partner-badge.dto';

function mapBadgeRow(row: Record<string, unknown>): PartnerBadgeDefinition {
  return {
    code: String(row.code ?? '').trim().toUpperCase() as PartnerBadgeCode,
    name: String(row.name ?? '').trim(),
    icon: String(row.icon ?? '').trim(),
    payoutDelayDays: Number(row.payoutDelayDays ?? 0),
    sortOrder: Number(row.sortOrder ?? 0),
  };
}

@Injectable()
export class PartnerBadgesService implements OnModuleInit {
  private readonly logger = new Logger(PartnerBadgesService.name);

  constructor(
    @InjectModel(PartnerBadgeModel.name)
    private readonly badgeModel: Model<PartnerBadgeModel>,
    private readonly stripeConnect: StripeConnectService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeeded();
    await this.refreshCache();
  }

  private assertAdmin(user: UserModel): void {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  private async ensureSeeded(): Promise<void> {
    const count = await this.badgeModel.countDocuments().exec();
    if (count > 0) return;
    for (const seed of DEFAULT_PARTNER_BADGE_SEEDS) {
      await this.badgeModel.create({
        code: seed.code,
        name: seed.name,
        icon: seed.icon,
        payoutDelayDays: seed.payoutDelayDays,
        sortOrder: seed.sortOrder ?? 0,
      });
    }
    this.logger.log(`Seeded ${DEFAULT_PARTNER_BADGE_SEEDS.length} partner badges`);
  }

  async refreshCache(): Promise<PartnerBadgeDefinition[]> {
    const rows = await this.badgeModel
      .find({})
      .sort({ sortOrder: 1, code: 1 })
      .lean()
      .exec();
    const defs = (rows as Record<string, unknown>[]).map(mapBadgeRow);
    setPartnerBadgeDefinitionsCache(defs);
    return defs;
  }

  listForRuntime(): PartnerBadgeDefinition[] {
    return listPartnerBadgeDefinitions();
  }

  async listForAdmin(user: UserModel): Promise<PartnerBadgeDefinition[]> {
    this.assertAdmin(user);
    const rows = await this.badgeModel
      .find({})
      .sort({ sortOrder: 1, code: 1 })
      .lean()
      .exec();
    return (rows as Record<string, unknown>[]).map(mapBadgeRow);
  }

  async updateForAdmin(
    user: UserModel,
    codeRaw: string,
    dto: UpdatePartnerBadgeDto,
  ): Promise<PartnerBadgeDefinition> {
    this.assertAdmin(user);
    const code = String(codeRaw ?? '')
      .trim()
      .toUpperCase();
    if (!isPartnerBadgeCode(code)) {
      throw new NotFoundException('partner_badge_not_found');
    }

    const patch: Record<string, unknown> = {};
    if (dto.name != null) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('partner_badge_name_required');
      patch.name = name;
    }
    if (dto.icon != null) {
      const icon = dto.icon.trim();
      if (!icon) throw new BadRequestException('partner_badge_icon_required');
      patch.icon = icon;
    }
    if (dto.payoutDelayDays != null) {
      patch.payoutDelayDays = dto.payoutDelayDays;
    }
    if (dto.sortOrder != null) {
      patch.sortOrder = dto.sortOrder;
    }
    if (!Object.keys(patch).length) {
      throw new BadRequestException('partner_badge_no_changes');
    }

    const existing = await this.badgeModel.findOne({ code }).lean().exec();
    if (!existing) {
      throw new NotFoundException('partner_badge_not_found');
    }
    const previousPayoutDelayDays = Number(existing.payoutDelayDays ?? 0);

    const updated = await this.badgeModel
      .findOneAndUpdate({ code }, { $set: patch }, { new: true })
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException('partner_badge_not_found');
    }

    await this.refreshCache();

    const nextPayoutDelayDays = Number(updated.payoutDelayDays ?? 0);
    if (
      dto.payoutDelayDays != null &&
      previousPayoutDelayDays !== nextPayoutDelayDays
    ) {
      void this.stripeConnect
        .resyncPayoutSchedulesForBadgeCode(code as PartnerBadgeCode)
        .catch((e) =>
          this.logger.warn(
            `partner_badge_stripe_resync_failed code=${code}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    }

    return mapBadgeRow(updated as Record<string, unknown>);
  }
}
