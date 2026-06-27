import {
  moderationFieldsFromDoc,
  moderationStatusFromDoc,
} from '@common/moderation/catalog-moderation.util';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { VendorStatusEmailService } from '@modules/vendor-emails/vendor-status-email.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AdModerationStatusEnum } from '@schemas/ad.schema';
import { DrinkModel } from '@schemas/drink.schema';
import {
  ProductModel,
  ProductStatusEnum,
} from '@schemas/product.schema';
import { StockItemModel } from '@schemas/stock-item.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  CatalogModerationKindEnum,
  ListCatalogModerationQueryDto,
} from './dto/list-catalog-moderation-query.dto';

export type CatalogModerationRow = {
  id: string;
  kind: CatalogModerationKindEnum;
  title: string;
  storeId: string | null;
  storeName: string | null;
  moderationStatus: AdModerationStatusEnum;
  moderationBlockReason: string | null;
  moderationReviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

@Injectable()
export class AdminCatalogModerationService {
  constructor(
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    @InjectModel(DrinkModel.name)
    private readonly drinkModel: Model<DrinkModel>,
    @InjectModel(StockItemModel.name)
    private readonly stockItemModel: Model<StockItemModel>,
    private readonly storeAccess: StoreAccessService,
    private readonly vendorStatusEmail: VendorStatusEmailService,
  ) {}

  private storeIdFromDoc(doc: { store?: unknown }): string | null {
    const store = doc.store;
    if (!store) return null;
    if (typeof store === 'object' && store !== null && '_id' in store) {
      return String((store as { _id: unknown })._id);
    }
    return String(store);
  }

  private queueCatalogModerationNotify(args: {
    storeId: string | null;
    kind: CatalogModerationKindEnum;
    itemId: string;
    itemTitle: string;
    previousStatus: AdModerationStatusEnum;
    newStatus: AdModerationStatusEnum;
    blockReason?: string | null;
  }): void {
    const sid = args.storeId?.trim();
    if (!sid || !Types.ObjectId.isValid(sid)) return;
    void this.vendorStatusEmail
      .notifyCatalogModerationStatusChange({
        storeId: sid,
        kind: args.kind,
        itemId: args.itemId,
        itemTitle: args.itemTitle,
        previousStatus: args.previousStatus,
        newStatus: args.newStatus,
        blockReason: args.blockReason,
      })
      .catch(() => undefined);
  }

  private async assertAdmin(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.catalog');
  }

  private buildSearchFilter(search?: string): Record<string, unknown> | null {
    const q = search?.trim();
    if (!q) return null;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { $regex: escaped, $options: 'i' };
  }

  private statusFilter(
    status?: AdModerationStatusEnum,
  ): FilterQuery<unknown> | null {
    if (!status) return null;
    if (status === AdModerationStatusEnum.APPROVED) {
      return {
        $or: [
          { moderationStatus: { $exists: false } },
          { moderationStatus: null },
          { moderationStatus: AdModerationStatusEnum.APPROVED },
        ],
      };
    }
    return { moderationStatus: status };
  }

  private serializeFood(
    doc: Record<string, unknown>,
  ): CatalogModerationRow {
    const store = doc.store as Record<string, unknown> | undefined;
    const mod = moderationFieldsFromDoc(doc);
    return {
      id: String(doc._id ?? ''),
      kind: CatalogModerationKindEnum.FOOD,
      title: String(doc.title ?? ''),
      storeId: store?._id ? String(store._id) : store ? String(store) : null,
      storeName:
        typeof store?.name === 'string' ? store.name : null,
      ...mod,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : null,
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : null,
    };
  }

  private serializeDrink(
    doc: Record<string, unknown>,
  ): CatalogModerationRow {
    const store = doc.store as Record<string, unknown> | undefined;
    const mod = moderationFieldsFromDoc(doc);
    return {
      id: String(doc._id ?? ''),
      kind: CatalogModerationKindEnum.DRINK,
      title: String(doc.name ?? ''),
      storeId: store?._id ? String(store._id) : store ? String(store) : null,
      storeName:
        typeof store?.name === 'string' ? store.name : null,
      ...mod,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : null,
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : null,
    };
  }

  private serializeItem(
    doc: Record<string, unknown>,
  ): CatalogModerationRow {
    const store = doc.store as Record<string, unknown> | undefined;
    const mod = moderationFieldsFromDoc(doc);
    return {
      id: String(doc._id ?? ''),
      kind: CatalogModerationKindEnum.ITEM,
      title: String(doc.produit ?? ''),
      storeId: store?._id ? String(store._id) : store ? String(store) : null,
      storeName:
        typeof store?.name === 'string' ? store.name : null,
      ...mod,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : null,
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : null,
    };
  }

  private async fetchKindRows(
    kind: CatalogModerationKindEnum,
    query: ListCatalogModerationQueryDto,
  ): Promise<CatalogModerationRow[]> {
    const statusPart = this.statusFilter(query.status);
    const searchRegex = this.buildSearchFilter(query.search);
    const filter: FilterQuery<unknown> = {};
    if (statusPart) Object.assign(filter, statusPart);

    if (kind === CatalogModerationKindEnum.FOOD) {
      if (searchRegex) filter.title = searchRegex;
      const rows = await this.productModel
        .find(filter)
        .populate('store', 'name')
        .sort({ updatedAt: -1 })
        .lean()
        .exec();
      return rows.map((row) =>
        this.serializeFood(row as unknown as Record<string, unknown>),
      );
    }

    if (kind === CatalogModerationKindEnum.DRINK) {
      if (searchRegex) filter.name = searchRegex;
      const rows = await this.drinkModel
        .find(filter)
        .populate('store', 'name')
        .sort({ updatedAt: -1 })
        .lean()
        .exec();
      return rows.map((row) =>
        this.serializeDrink(row as unknown as Record<string, unknown>),
      );
    }

    if (searchRegex) filter.produit = searchRegex;
    const rows = await this.stockItemModel
      .find(filter)
      .populate('store', 'name')
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return rows.map((row) =>
      this.serializeItem(row as unknown as Record<string, unknown>),
    );
  }

  async list(
    actor: UserModel,
    query: ListCatalogModerationQueryDto,
  ): Promise<{
    items: CatalogModerationRow[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    await this.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const kinds = query.kind
      ? [query.kind]
      : [
          CatalogModerationKindEnum.FOOD,
          CatalogModerationKindEnum.DRINK,
          CatalogModerationKindEnum.ITEM,
        ];

    const merged: CatalogModerationRow[] = [];
    for (const kind of kinds) {
      const rows = await this.fetchKindRows(kind, query);
      merged.push(...rows);
    }
    merged.sort((a, b) => {
      const ad = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bd = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bd - ad;
    });

    const total = merged.length;
    const start = (page - 1) * limit;
    const items = merged.slice(start, start + limit);
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private resolveKind(kindRaw: string): CatalogModerationKindEnum {
    const kind = kindRaw.trim().toUpperCase();
    if (kind === CatalogModerationKindEnum.FOOD) {
      return CatalogModerationKindEnum.FOOD;
    }
    if (kind === CatalogModerationKindEnum.DRINK) {
      return CatalogModerationKindEnum.DRINK;
    }
    if (kind === CatalogModerationKindEnum.ITEM) {
      return CatalogModerationKindEnum.ITEM;
    }
    throw new BadRequestException('invalid_catalog_kind');
  }

  async blockItem(
    actor: UserModel,
    kindRaw: string,
    itemId: string,
    blockReason: string,
  ): Promise<CatalogModerationRow> {
    await this.assertAdmin(actor);
    const kind = this.resolveKind(kindRaw);
    const reason = blockReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('catalog_block_reason_required');
    }
    if (!Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException('invalid_catalog_item_id');
    }

    const reviewedAt = new Date();
    const reviewedBy = actor._id;

    if (kind === CatalogModerationKindEnum.FOOD) {
      const existing = await this.productModel.findById(itemId).exec();
      if (!existing) throw new NotFoundException('catalog_item_not_found');
      const previousStatus = moderationStatusFromDoc(
        existing.toObject() as Record<string, unknown>,
      );
      if (previousStatus === AdModerationStatusEnum.BLOCKED) {
        throw new BadRequestException('catalog_item_already_blocked');
      }
      const storeId = this.storeIdFromDoc(existing);
      existing.moderationStatus = AdModerationStatusEnum.BLOCKED;
      existing.moderationBlockReason = reason;
      existing.moderationReviewedAt = reviewedAt;
      existing.set('moderationReviewedBy', reviewedBy);
      existing.status = ProductStatusEnum.BLOCKED;
      await existing.save();
      this.queueCatalogModerationNotify({
        storeId,
        kind,
        itemId,
        itemTitle: String(existing.title ?? ''),
        previousStatus,
        newStatus: AdModerationStatusEnum.BLOCKED,
        blockReason: reason,
      });
      const lean = await this.productModel
        .findById(itemId)
        .populate('store', 'name')
        .lean()
        .exec();
      return this.serializeFood(lean as Record<string, unknown>);
    }

    if (kind === CatalogModerationKindEnum.DRINK) {
      const existing = await this.drinkModel.findById(itemId).exec();
      if (!existing) throw new NotFoundException('catalog_item_not_found');
      const previousStatus = moderationStatusFromDoc(
        existing.toObject() as Record<string, unknown>,
      );
      if (previousStatus === AdModerationStatusEnum.BLOCKED) {
        throw new BadRequestException('catalog_item_already_blocked');
      }
      const storeId = this.storeIdFromDoc(existing);
      existing.moderationStatus = AdModerationStatusEnum.BLOCKED;
      existing.moderationBlockReason = reason;
      existing.moderationReviewedAt = reviewedAt;
      existing.set('moderationReviewedBy', reviewedBy);
      await existing.save();
      this.queueCatalogModerationNotify({
        storeId,
        kind,
        itemId,
        itemTitle: String(existing.name ?? ''),
        previousStatus,
        newStatus: AdModerationStatusEnum.BLOCKED,
        blockReason: reason,
      });
      const lean = await this.drinkModel
        .findById(itemId)
        .populate('store', 'name')
        .lean()
        .exec();
      return this.serializeDrink(lean as Record<string, unknown>);
    }

    const existing = await this.stockItemModel.findById(itemId).exec();
    if (!existing) throw new NotFoundException('catalog_item_not_found');
    const previousStatus = moderationStatusFromDoc(
      existing.toObject() as Record<string, unknown>,
    );
    if (previousStatus === AdModerationStatusEnum.BLOCKED) {
      throw new BadRequestException('catalog_item_already_blocked');
    }
    const storeId = this.storeIdFromDoc(existing);
    existing.moderationStatus = AdModerationStatusEnum.BLOCKED;
    existing.moderationBlockReason = reason;
    existing.moderationReviewedAt = reviewedAt;
    existing.set('moderationReviewedBy', reviewedBy);
    await existing.save();
    this.queueCatalogModerationNotify({
      storeId,
      kind,
      itemId,
      itemTitle: String(existing.produit ?? ''),
      previousStatus,
      newStatus: AdModerationStatusEnum.BLOCKED,
      blockReason: reason,
    });
    const lean = await this.stockItemModel
      .findById(itemId)
      .populate('store', 'name')
      .lean()
      .exec();
    return this.serializeItem(lean as Record<string, unknown>);
  }

  async unblockItem(
    actor: UserModel,
    kindRaw: string,
    itemId: string,
  ): Promise<CatalogModerationRow> {
    await this.assertAdmin(actor);
    const kind = this.resolveKind(kindRaw);
    if (!Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException('invalid_catalog_item_id');
    }

    const reviewedAt = new Date();
    const reviewedBy = actor._id;
    const patch = {
      moderationStatus: AdModerationStatusEnum.APPROVED,
      moderationBlockReason: null,
      moderationReviewedAt: reviewedAt,
      moderationReviewedBy: reviewedBy,
    };

    if (kind === CatalogModerationKindEnum.FOOD) {
      const existing = await this.productModel.findById(itemId).exec();
      if (!existing) throw new NotFoundException('catalog_item_not_found');
      const previousStatus = moderationStatusFromDoc(
        existing.toObject() as Record<string, unknown>,
      );
      const storeId = this.storeIdFromDoc(existing);
      Object.assign(existing, patch);
      existing.status = ProductStatusEnum.ACTIVE;
      await existing.save();
      this.queueCatalogModerationNotify({
        storeId,
        kind,
        itemId,
        itemTitle: String(existing.title ?? ''),
        previousStatus,
        newStatus: AdModerationStatusEnum.APPROVED,
      });
      const lean = await this.productModel
        .findById(itemId)
        .populate('store', 'name')
        .lean()
        .exec();
      return this.serializeFood(lean as Record<string, unknown>);
    }

    if (kind === CatalogModerationKindEnum.DRINK) {
      const existing = await this.drinkModel.findById(itemId).exec();
      if (!existing) throw new NotFoundException('catalog_item_not_found');
      const previousStatus = moderationStatusFromDoc(
        existing.toObject() as Record<string, unknown>,
      );
      const storeId = this.storeIdFromDoc(existing);
      Object.assign(existing, patch);
      await existing.save();
      this.queueCatalogModerationNotify({
        storeId,
        kind,
        itemId,
        itemTitle: String(existing.name ?? ''),
        previousStatus,
        newStatus: AdModerationStatusEnum.APPROVED,
      });
      const lean = await this.drinkModel
        .findById(itemId)
        .populate('store', 'name')
        .lean()
        .exec();
      return this.serializeDrink(lean as Record<string, unknown>);
    }

    const existing = await this.stockItemModel.findById(itemId).exec();
    if (!existing) throw new NotFoundException('catalog_item_not_found');
    const previousStatus = moderationStatusFromDoc(
      existing.toObject() as Record<string, unknown>,
    );
    const storeId = this.storeIdFromDoc(existing);
    Object.assign(existing, patch);
    await existing.save();
    this.queueCatalogModerationNotify({
      storeId,
      kind,
      itemId,
      itemTitle: String(existing.produit ?? ''),
      previousStatus,
      newStatus: AdModerationStatusEnum.APPROVED,
    });
    const lean = await this.stockItemModel
      .findById(itemId)
      .populate('store', 'name')
      .lean()
      .exec();
    return this.serializeItem(lean as Record<string, unknown>);
  }
}
