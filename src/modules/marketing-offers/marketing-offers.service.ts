import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MarketingOfferItemModel,
  MarketingOfferModel,
  MarketingOfferModerationStatusEnum,
  MarketingOfferSectionModel,
} from '@schemas/marketing-offer.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  CreateMarketingOfferItemDto,
  PatchMarketingOfferItemDto,
  PatchMarketingOfferModerationDto,
} from './dto/marketing-offers.dto';
import {
  MARKETING_OFFER_SECTION_SEEDS,
  MARKETING_OFFER_SEEDS,
} from './marketing-offer-catalog.seed';

export type MarketingOfferSectionRow = {
  id: string;
  code: string;
  titleFr: string;
  titleEn: string;
  sortOrder: number;
};

export type MarketingOfferRow = {
  id: string;
  number: number;
  type: string;
  sectionId: string;
  sectionCode: string;
  name: string;
  rule: string;
  example: string;
  phase: string;
  priority: string;
  complexity: string;
  moderationStatus: MarketingOfferModerationStatusEnum;
  itemCount: number;
};

export type MarketingOfferItemRow = {
  id: string;
  offerId: string;
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type MarketingOffersGroupedResponse = {
  sections: Array<
    MarketingOfferSectionRow & {
      offers: MarketingOfferRow[];
    }
  >;
};

function assertAdmin(user: UserModel): void {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function toIso(d: unknown): string | undefined {
  if (!d) return undefined;
  const dt = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

@Injectable()
export class MarketingOffersService implements OnModuleInit {
  private readonly logger = new Logger(MarketingOffersService.name);

  constructor(
    @InjectModel(MarketingOfferSectionModel.name)
    private readonly sectionModel: Model<MarketingOfferSectionModel>,
    @InjectModel(MarketingOfferModel.name)
    private readonly offerModel: Model<MarketingOfferModel>,
    @InjectModel(MarketingOfferItemModel.name)
    private readonly itemModel: Model<MarketingOfferItemModel>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeeded();
  }

  private async ensureSeeded(): Promise<void> {
    for (const seed of MARKETING_OFFER_SECTION_SEEDS) {
      await this.sectionModel.updateOne(
        { code: seed.code },
        {
          $setOnInsert: {
            code: seed.code,
            titleFr: seed.titleFr,
            titleEn: seed.titleEn,
            sortOrder: seed.sortOrder,
          },
        },
        { upsert: true },
      );
    }

    const sections = await this.sectionModel.find({}).lean().exec();
    const sectionByCode = new Map(
      sections.map((s) => [String(s.code).toUpperCase(), s]),
    );

    for (const seed of MARKETING_OFFER_SEEDS) {
      const section = sectionByCode.get(seed.sectionCode.toUpperCase());
      if (!section?._id) continue;
      await this.offerModel.updateOne(
        { number: seed.number },
        {
          $setOnInsert: {
            number: seed.number,
            type: seed.type,
            sectionId: section._id,
            name: seed.name,
            rule: seed.rule,
            example: seed.example,
            phase: seed.phase,
            priority: seed.priority,
            complexity: seed.complexity,
            moderationStatus: MarketingOfferModerationStatusEnum.APPROVED,
          },
        },
        { upsert: true },
      );
    }

    this.logger.log(
      `Marketing offers catalog ready (${MARKETING_OFFER_SEEDS.length} strategies)`,
    );
  }

  async listGroupedForAdmin(
    user: UserModel,
  ): Promise<MarketingOffersGroupedResponse> {
    assertAdmin(user);

    const sections = await this.sectionModel
      .find({})
      .sort({ sortOrder: 1, code: 1 })
      .lean()
      .exec();
    const offers = await this.offerModel
      .find({})
      .sort({ number: 1 })
      .lean()
      .exec();
    const itemCounts = await this.itemModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $group: { _id: '$offerId', count: { $sum: 1 } } },
    ]);

    const countByOfferId = new Map(
      itemCounts.map((row) => [String(row._id), row.count]),
    );
    const sectionById = new Map(
      sections.map((s) => [String(s._id), s]),
    );

    const offersBySectionId = new Map<string, MarketingOfferRow[]>();
    for (const offer of offers) {
      const sectionId = String(offer.sectionId);
      const section = sectionById.get(sectionId);
      const row: MarketingOfferRow = {
        id: String(offer._id),
        number: Number(offer.number),
        type: String(offer.type),
        sectionId,
        sectionCode: String(section?.code ?? ''),
        name: String(offer.name),
        rule: String(offer.rule),
        example: String(offer.example),
        phase: String(offer.phase),
        priority: String(offer.priority),
        complexity: String(offer.complexity),
        moderationStatus:
          (offer.moderationStatus as MarketingOfferModerationStatusEnum) ??
          MarketingOfferModerationStatusEnum.APPROVED,
        itemCount: countByOfferId.get(String(offer._id)) ?? 0,
      };
      const list = offersBySectionId.get(sectionId) ?? [];
      list.push(row);
      offersBySectionId.set(sectionId, list);
    }

    return {
      sections: sections.map((section) => ({
        id: String(section._id),
        code: String(section.code),
        titleFr: String(section.titleFr),
        titleEn: String(section.titleEn),
        sortOrder: Number(section.sortOrder ?? 0),
        offers: offersBySectionId.get(String(section._id)) ?? [],
      })),
    };
  }

  async patchModerationForAdmin(
    user: UserModel,
    offerIdRaw: string,
    dto: PatchMarketingOfferModerationDto,
  ): Promise<MarketingOfferRow> {
    assertAdmin(user);
    const offerId = String(offerIdRaw ?? '').trim();
    if (!Types.ObjectId.isValid(offerId)) {
      throw new BadRequestException('invalid_offer_id');
    }

    const updated = await this.offerModel
      .findByIdAndUpdate(
        offerId,
        { $set: { moderationStatus: dto.moderationStatus } },
        { new: true },
      )
      .populate('sectionId')
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('marketing_offer_not_found');

    const itemCount = await this.itemModel.countDocuments({ offerId }).exec();
    const section = updated.sectionId as unknown as {
      _id?: Types.ObjectId;
      code?: string;
    } | null;

    return {
      id: String(updated._id),
      number: Number(updated.number),
      type: String(updated.type),
      sectionId: String(section?._id ?? updated.sectionId),
      sectionCode: String(section?.code ?? ''),
      name: String(updated.name),
      rule: String(updated.rule),
      example: String(updated.example),
      phase: String(updated.phase),
      priority: String(updated.priority),
      complexity: String(updated.complexity),
      moderationStatus: updated.moderationStatus,
      itemCount,
    };
  }

  private async assertOfferExists(offerId: string): Promise<void> {
    if (!Types.ObjectId.isValid(offerId)) {
      throw new BadRequestException('invalid_offer_id');
    }
    const exists = await this.offerModel.exists({ _id: offerId }).exec();
    if (!exists) throw new NotFoundException('marketing_offer_not_found');
  }

  async listItemsForAdmin(
    user: UserModel,
    offerIdRaw: string,
  ): Promise<MarketingOfferItemRow[]> {
    assertAdmin(user);
    const offerId = String(offerIdRaw ?? '').trim();
    await this.assertOfferExists(offerId);

    const rows = await this.itemModel
      .find({ offerId: new Types.ObjectId(offerId) })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();

    return rows.map((row) => this.mapItemRow(row));
  }

  async createItemForAdmin(
    user: UserModel,
    offerIdRaw: string,
    dto: CreateMarketingOfferItemDto,
  ): Promise<MarketingOfferItemRow> {
    assertAdmin(user);
    const offerId = String(offerIdRaw ?? '').trim();
    await this.assertOfferExists(offerId);

    const created = await this.itemModel.create({
      offerId: new Types.ObjectId(offerId),
      titleFr: dto.titleFr.trim(),
      titleEn: dto.titleEn.trim(),
      descriptionFr: dto.descriptionFr?.trim() ?? '',
      descriptionEn: dto.descriptionEn?.trim() ?? '',
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    return this.mapItemRow(created.toObject());
  }

  async patchItemForAdmin(
    user: UserModel,
    offerIdRaw: string,
    itemIdRaw: string,
    dto: PatchMarketingOfferItemDto,
  ): Promise<MarketingOfferItemRow> {
    assertAdmin(user);
    const offerId = String(offerIdRaw ?? '').trim();
    const itemId = String(itemIdRaw ?? '').trim();
    await this.assertOfferExists(offerId);
    if (!Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException('invalid_offer_item_id');
    }

    const patch: Record<string, unknown> = {};
    if (dto.titleFr != null) patch.titleFr = dto.titleFr.trim();
    if (dto.titleEn != null) patch.titleEn = dto.titleEn.trim();
    if (dto.descriptionFr != null) patch.descriptionFr = dto.descriptionFr.trim();
    if (dto.descriptionEn != null) patch.descriptionEn = dto.descriptionEn.trim();
    if (dto.sortOrder != null) patch.sortOrder = dto.sortOrder;
    if (dto.isActive != null) patch.isActive = dto.isActive;
    if (!Object.keys(patch).length) {
      throw new BadRequestException('marketing_offer_item_no_changes');
    }

    const updated = await this.itemModel
      .findOneAndUpdate(
        { _id: itemId, offerId: new Types.ObjectId(offerId) },
        { $set: patch },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('marketing_offer_item_not_found');
    return this.mapItemRow(updated);
  }

  async deleteItemForAdmin(
    user: UserModel,
    offerIdRaw: string,
    itemIdRaw: string,
  ): Promise<void> {
    assertAdmin(user);
    const offerId = String(offerIdRaw ?? '').trim();
    const itemId = String(itemIdRaw ?? '').trim();
    await this.assertOfferExists(offerId);
    if (!Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException('invalid_offer_item_id');
    }

    const deleted = await this.itemModel
      .findOneAndDelete({ _id: itemId, offerId: new Types.ObjectId(offerId) })
      .exec();
    if (!deleted) throw new NotFoundException('marketing_offer_item_not_found');
  }

  private mapItemRow(row: Record<string, unknown>): MarketingOfferItemRow {
    return {
      id: String(row._id),
      offerId: String(row.offerId),
      titleFr: String(row.titleFr ?? ''),
      titleEn: String(row.titleEn ?? ''),
      descriptionFr: String(row.descriptionFr ?? ''),
      descriptionEn: String(row.descriptionEn ?? ''),
      sortOrder: Number(row.sortOrder ?? 0),
      isActive: row.isActive !== false,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }
}
