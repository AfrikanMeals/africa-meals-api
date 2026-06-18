import { escapeMongoRegex } from '@common/mongo/escape-regex.util';
import {
  isStripeConnectOnboardingCompleteUser,
  productEmbeddedStoreOwnerStripeOnboardedStages,
  resolveStoreIdsVisibleOnMobileApp,
} from '@modules/billing/stripe/stripe-connect-visibility';
import { MediasService } from '@modules/medias/medias.service';
import { ProductCategoryService } from '@modules/products/product-category.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DrinkModel, DrinkStatutEnum } from '@schemas/drink.schema';
import { resolveProductCategoryKind } from '@modules/products/data/categories';
import { ProductCategoryKindEnum, ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, PipelineStage, Types } from 'mongoose';
import { CreateDrinkDto, PatchDrinkDto } from './dto/drink.dto';
import { SearchDto } from '@modules/search/dto/search.dto';

function computeStatut(quantite: number, seuil: number): DrinkStatutEnum {
  return quantite <= seuil ? DrinkStatutEnum.ALERTE : DrinkStatutEnum.OK;
}

/** Filtre catalogue client mobile : boissons encore en stock. */
export const DRINK_IN_STOCK_FILTER = { quantite: { $gt: 0 } } as const;

/** Quantité max commandable pour une boisson = stock `quantite` (le seuil sert uniquement à l’alerte stock). */
export function maxDrinkOrderQuantity(quantite: number): number {
  return Math.max(0, Math.floor(Number(quantite)));
}

/** Liste catalogue vendeur mobile (champs affichés uniquement). */
function mapDrinkCatalogListRow(doc: Record<string, unknown>) {
  const img =
    doc.imageUrl != null
      ? String(doc.imageUrl)
      : doc.image_url != null
      ? String(doc.image_url)
      : '';
  const imageUrl =
    img.startsWith('http://') || img.startsWith('https://') ? img : undefined;
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    description: doc.description != null ? String(doc.description) : '',
    priceCad: Number(doc.priceCad ?? doc.price_cad ?? 0),
    quantite: Number(doc.quantite ?? 0),
    seuil: Number(doc.seuil ?? 0),
    statut: String(doc.statut ?? DrinkStatutEnum.OK),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function mapDrinkDoc(doc: Record<string, unknown>) {
  const created = doc.createdAt;
  const updated = doc.updatedAt;
  const rawCat = doc.category;
  let categoryId: string | undefined;
  let categoryTitle: string | undefined;
  if (rawCat != null && typeof rawCat === 'object') {
    const c = rawCat as Record<string, unknown>;
    const oid = c._id ?? c.id;
    if (oid != null) categoryId = String(oid);
    if (c.title != null) categoryTitle = String(c.title);
  } else if (rawCat != null) {
    categoryId = String(rawCat);
  }
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    description: doc.description != null ? String(doc.description) : '',
    quantite: Number(doc.quantite ?? 0),
    seuil: Number(doc.seuil ?? 0),
    priceCad: Number(doc.priceCad ?? doc.price_cad ?? 0),
    statut: String(doc.statut ?? DrinkStatutEnum.OK) as DrinkStatutEnum,
    imageUrl:
      doc.imageUrl != null
        ? String(doc.imageUrl)
        : doc.image_url != null
        ? String(doc.image_url)
        : undefined,
    ...(categoryId ? { categoryId } : {}),
    ...(categoryTitle ? { categoryTitle } : {}),
    createdAt:
      created instanceof Date
        ? created.toISOString()
        : typeof created === 'string'
        ? created
        : undefined,
    updatedAt:
      updated instanceof Date
        ? updated.toISOString()
        : typeof updated === 'string'
        ? updated
        : undefined,
  };
}

@Injectable()
export class DrinksService {
  private _escapeRegex(s: string): string {
    return escapeMongoRegex(s);
  }

  @InjectModel(DrinkModel.name)
  private readonly _drinkModel: Model<DrinkModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(SubscriptionsService)
  private readonly _subscriptionsService: SubscriptionsService;

  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @Inject(ProductCategoryService)
  private readonly _productCategoryService: ProductCategoryService;

  private async _invalidateCategoryCountsCache(): Promise<void> {
    await this._productCategoryService.invalidatePublicListCache();
  }

  private async isStoreActiveForCatalog(storeId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(storeId)) {
      return false;
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('status')
      .lean()
      .exec();
    return store?.status === StoreStatusEnum.ACTIVE;
  }

  private async isStoreVisibleOnMobileApp(storeId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(storeId)) {
      return false;
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('status owner')
      .lean()
      .exec();
    if (!store || store.status !== StoreStatusEnum.ACTIVE) {
      return false;
    }
    const owner = await this._userModel
      .findById(store.owner)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
      .lean()
      .exec();
    return isStripeConnectOnboardingCompleteUser(owner);
  }

  private async assertStoreCatalogAccess(
    storeId: string,
    user: UserModel,
    permission: 'catalog.view' | 'catalog.edit',
  ) {
    await this._storeAccess.assertStoreAccess(user, storeId, permission);
  }

  private async resolveDrinkCategoryId(
    categoryId?: string,
  ): Promise<Types.ObjectId | undefined> {
    const id = categoryId?.trim();
    if (!id) return undefined;
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('category_not_found');
    }
    const cat = await this._productCategoryModel
      .findById(id)
      .select('kind icon isEnabled title')
      .lean()
      .exec();
    if (!cat || cat.isEnabled === false) {
      throw new NotFoundException('category_not_found');
    }
    const kind = resolveProductCategoryKind(cat as Record<string, unknown>);
    if (kind === ProductCategoryKindEnum.DRINK) {
      return new Types.ObjectId(id);
    }
    throw new BadRequestException('category_must_be_drink');
  }

  private async accessibleDrinkIdsForStore(
    storeId: string,
  ): Promise<Set<string> | null> {
    const resolved =
      await this._subscriptionsService.resolveAccessibleCatalogIdsForStore(
        storeId,
      );
    return resolved.limit == null ? null : resolved.drinkIds;
  }

  private async assertDrinkAccessibleForStore(
    storeId: string,
    drinkId: string,
  ) {
    const isAllowed =
      await this._subscriptionsService.isCatalogItemAccessibleForStore(
        storeId,
        drinkId,
        'drink',
      );
    if (!isAllowed) {
      throw new ForbiddenException('catalog_item_locked_by_plan_limit');
    }
  }

  /** Détail boisson — propriétaire boutique. */
  async findOneForStoreOwner(
    storeId: string,
    drinkId: string,
    user: UserModel,
  ) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.view');
    await this.assertDrinkAccessibleForStore(storeId, drinkId);
    if (!Types.ObjectId.isValid(storeId) || !Types.ObjectId.isValid(drinkId)) {
      throw new NotFoundException('drink_not_found');
    }
    const row = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
      })
      .populate('category', 'title kind isEnabled')
      .lean()
      .exec();
    if (!row) {
      throw new NotFoundException('drink_not_found');
    }
    return mapDrinkDoc(row as Record<string, unknown>);
  }

  async findByStoreForOwner(storeId: string, user: UserModel) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.view');
    if (!Types.ObjectId.isValid(storeId)) {
      return [];
    }
    const allowed = await this.accessibleDrinkIdsForStore(storeId);
    const baseFilter: Record<string, unknown> = {
      store: new Types.ObjectId(storeId),
    };
    if (allowed != null) {
      const ids = [...allowed].filter((id) => Types.ObjectId.isValid(id));
      if (!ids.length) return [];
      baseFilter._id = { $in: ids.map((id) => new Types.ObjectId(id)) };
    }
    const rows = await this._drinkModel
      .find(baseFilter)
      .sort({ updatedAt: -1 })
      .populate('category', 'title kind isEnabled')
      .lean()
      .exec();
    return rows.map((r) => mapDrinkDoc(r as Record<string, unknown>));
  }

  async countByStoreId(storeId: string): Promise<number> {
    if (!Types.ObjectId.isValid(storeId)) return 0;
    return this._drinkModel
      .countDocuments({ store: new Types.ObjectId(storeId) })
      .exec();
  }

  /** Catalogue boissons vendeur (pagination + recherche, payload minimal). */
  async findByStoreForOwnerPaginated(
    storeId: string,
    user: UserModel,
    opts: { page: number; take: number; q?: string },
  ) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.view');
    if (!Types.ObjectId.isValid(storeId)) {
      return { items: [], total: 0, page: 1, limit: opts.take };
    }
    const allowed = await this.accessibleDrinkIdsForStore(storeId);
    const storeOid = new Types.ObjectId(storeId);
    const match: Record<string, unknown> = { store: storeOid };
    if (allowed != null) {
      const ids = [...allowed].filter((id) => Types.ObjectId.isValid(id));
      if (!ids.length) {
        return { items: [], total: 0, page: 1, limit: opts.take };
      }
      match._id = { $in: ids.map((id) => new Types.ObjectId(id)) };
    }
    const q = opts.q?.trim();
    if (q) {
      const esc = this._escapeRegex(q);
      match.$or = [
        { name: { $regex: esc, $options: 'i' } },
        { description: { $regex: esc, $options: 'i' } },
      ];
    }
    const page = Math.max(1, opts.page);
    const take = Math.min(80, Math.max(8, opts.take));
    const skip = (page - 1) * take;

    const agg = await this._drinkModel
      .aggregate([
        { $match: match },
        {
          $facet: {
            total: [{ $count: 'n' }],
            rows: [
              { $sort: { updatedAt: -1 } },
              { $skip: skip },
              { $limit: take },
              {
                $project: {
                  name: 1,
                  description: 1,
                  quantite: 1,
                  seuil: 1,
                  statut: 1,
                  price_cad: 1,
                  priceCad: 1,
                  image_url: 1,
                  imageUrl: 1,
                },
              },
            ],
          },
        },
      ])
      .exec();

    const bucket = agg[0] as
      | { total?: { n?: number }[]; rows?: Record<string, unknown>[] }
      | undefined;
    const total = bucket?.total?.[0]?.n ?? 0;
    const rows = bucket?.rows ?? [];

    return {
      items: rows.map((r) => mapDrinkCatalogListRow(r)),
      total,
      page,
      limit: take,
    };
  }

  /**
   * Liste catalogue client (sans JWT) : boutique existante + boissons encore en stock.
   * @param searchQuery — optionnel : filtre insensible à la casse sur `name` / `description` (regex échappée).
   */
  async findByStoreForCatalog(
    storeId: string,
    searchQuery?: string,
    clientPlatform?: string,
  ) {
    if (!Types.ObjectId.isValid(storeId)) {
      return [];
    }
    const visible =
      clientPlatform === 'web'
        ? await this.isStoreActiveForCatalog(storeId)
        : await this.isStoreVisibleOnMobileApp(storeId);
    if (!visible) {
      return [];
    }
    const baseFilter: Record<string, unknown> = {
      store: new Types.ObjectId(storeId),
      ...DRINK_IN_STOCK_FILTER,
    };
    const q = searchQuery?.trim();
    if (q) {
      const esc = this._escapeRegex(q);
      baseFilter['$or'] = [
        { name: { $regex: esc, $options: 'i' } },
        { description: { $regex: esc, $options: 'i' } },
      ];
    }
    let query = this._drinkModel
      .find(baseFilter)
      .populate('category', 'title kind isEnabled')
      .sort({ updatedAt: -1 })
      .lean();
    if (q) {
      query = query.limit(80);
    }
    const rows = await query.exec();
    return rows.map((r) => mapDrinkDoc(r as Record<string, unknown>));
  }

  /**
   * Une boisson du catalogue client (boutique + stock > 0), ou `null`.
   */
  async findOneInStoreCatalog(
    storeId: string,
    drinkId: string,
  ): Promise<ReturnType<typeof mapDrinkDoc> | null> {
    if (!Types.ObjectId.isValid(storeId) || !Types.ObjectId.isValid(drinkId)) {
      return null;
    }
    const row = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
        ...DRINK_IN_STOCK_FILTER,
      })
      .lean()
      .exec();
    if (!row) {
      return null;
    }
    return mapDrinkDoc(row as Record<string, unknown>);
  }

  /**
   * Catalogue marketplace : boissons en stock, boutiques visibles client.
   * Pas de filtre géo (aligné sur le filtre catégorie côté mobile).
   */
  async filterMarketplaceCatalog(args: SearchDto) {
    const page = Math.max(1, Math.floor(args.page ?? 1));
    const take = Math.min(80, Math.max(1, Math.floor(args.take ?? 40)));
    const match: Record<string, unknown> = { ...DRINK_IN_STOCK_FILTER };
    const cid = args.categoryId?.trim();
    if (cid && Types.ObjectId.isValid(cid)) {
      match.category = new Types.ObjectId(cid);
    }
    const q = args.query?.trim();
    if (q) {
      const esc = this._escapeRegex(q);
      match.$or = [
        { name: { $regex: esc, $options: 'i' } },
        { description: { $regex: esc, $options: 'i' } },
      ];
    }

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: 'stores',
          localField: 'store',
          foreignField: '_id',
          as: 'store',
        },
      },
      {
        $addFields: {
          store: { $arrayElemAt: ['$store', 0] },
        },
      },
      {
        $match: {
          'store.status': StoreStatusEnum.ACTIVE,
          'store.acceptsOrders': true,
        },
      },
      ...productEmbeddedStoreOwnerStripeOnboardedStages(),
      {
        $facet: {
          rows: [
            { $sort: { updatedAt: -1 } },
            { $skip: (page - 1) * take },
            { $limit: take },
            {
              $lookup: {
                from: 'product_categories',
                localField: 'category',
                foreignField: '_id',
                as: '_cat',
              },
            },
            {
              $addFields: {
                category: { $arrayElemAt: ['$_cat', 0] },
              },
            },
            { $project: { _cat: 0 } },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];

    const agg = await this._drinkModel
      .aggregate(pipeline)
      .option({ allowDiskUse: true })
      .exec();
    const facet = (agg[0] ?? {}) as {
      rows?: Record<string, unknown>[];
      total?: Array<{ n?: number }>;
    };
    const rows = facet.rows ?? [];
    const total = Number(facet.total?.[0]?.n ?? 0);
    const items = rows.map((row) => {
      const store = row['store'] as Record<string, unknown> | undefined;
      const storeId =
        store?._id != null
          ? String(store._id)
          : row['store'] != null
          ? String(row['store'])
          : '';
      const storeName = store?.name != null ? String(store.name) : '';
      return {
        ...mapDrinkDoc(row),
        ...(storeId ? { storeId } : {}),
        ...(storeName ? { storeName } : {}),
        ...(store?.currency != null
            ? { storeCurrency: String(store.currency) }
            : {}),
      };
    });
    return { items, total, page, limit: take };
  }

  /**
   * Boissons en stock pour plusieurs boutiques (recommandations accueil, etc.).
   */
  async findByStoresForCatalog(
    storeIds: string[],
    maxItems: number,
  ): Promise<Array<ReturnType<typeof mapDrinkDoc> & { storeId: string }>> {
    const candidateOids = storeIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!candidateOids.length) return [];
    const visible = await resolveStoreIdsVisibleOnMobileApp(
      this._storeModel,
      candidateOids,
    );
    const oids = candidateOids.filter((id) => visible.has(id.toString()));
    if (!oids.length) return [];
    const limit = Math.min(120, Math.max(1, Math.floor(maxItems)));
    const rows = await this._drinkModel
      .find({
        store: { $in: oids },
        ...DRINK_IN_STOCK_FILTER,
      })
      .populate('category', 'title kind isEnabled')
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((r) => {
      const raw = r as unknown as Record<string, unknown>;
      const storeRef = raw['store'];
      const storeId =
        storeRef != null &&
        typeof storeRef === 'object' &&
        'toString' in storeRef
          ? String(storeRef)
          : storeRef != null
          ? String(storeRef)
          : '';
      return {
        ...mapDrinkDoc(raw),
        storeId,
      };
    });
  }

  /** Validation panier : boisson de la boutique même si stock à 0. */
  async findOneInStoreByIdRaw(
    storeId: string,
    drinkId: string,
  ): Promise<ReturnType<typeof mapDrinkDoc> | null> {
    if (!Types.ObjectId.isValid(storeId) || !Types.ObjectId.isValid(drinkId)) {
      return null;
    }
    const row = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
      })
      .lean()
      .exec();
    if (!row) {
      return null;
    }
    return mapDrinkDoc(row as Record<string, unknown>);
  }

  async createForStore(
    storeId: string,
    dto: CreateDrinkDto,
    user: UserModel,
    file?: Express.Multer.File,
  ) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.edit');
    const catalogLimit =
      await this._subscriptionsService.resolveCatalogItemLimitForStore(storeId);
    if (catalogLimit != null) {
      const [foods, drinks] = await Promise.all([
        this._productModel
          .countDocuments({ store: new Types.ObjectId(storeId) })
          .exec(),
        this._drinkModel
          .countDocuments({ store: new Types.ObjectId(storeId) })
          .exec(),
      ]);
      if (foods + drinks >= catalogLimit) {
        throw new ForbiddenException('catalog_limit_reached_for_plan');
      }
    }
    const quantite = Number(dto.quantite);
    const seuil = Number(dto.seuil);
    const priceCad = Number(dto.priceCad);
    const statut = computeStatut(quantite, seuil);
    let imageUrl: string | undefined;
    if (file?.buffer?.length) {
      imageUrl = await this._mediasService.upload(
        file,
        user,
        `stores/${storeId}/drinks`,
      );
    }
    const categoryOid = await this.resolveDrinkCategoryId(dto.categoryId);
    const doc = await this._drinkModel.create({
      name: dto.name.trim(),
      description: dto.description?.trim() || undefined,
      quantite,
      seuil,
      priceCad,
      statut,
      store: new Types.ObjectId(storeId),
      ...(categoryOid ? { category: categoryOid } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    });
    const populated = await this._drinkModel
      .findById(doc._id)
      .populate('category', 'title kind isEnabled')
      .lean()
      .exec();
    await this._invalidateCategoryCountsCache();
    return mapDrinkDoc((populated ?? doc.toObject()) as Record<string, unknown>);
  }

  async updateForStore(
    storeId: string,
    drinkId: string,
    dto: PatchDrinkDto,
    user: UserModel,
    file?: Express.Multer.File,
  ) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.edit');
    await this.assertDrinkAccessibleForStore(storeId, drinkId);
    if (!Types.ObjectId.isValid(drinkId)) {
      throw new NotFoundException('drink_not_found');
    }
    const found = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
      })
      .exec();
    if (!found) {
      throw new NotFoundException('drink_not_found');
    }
    const quantite =
      dto.quantite !== undefined ? Number(dto.quantite) : found.quantite;
    const seuil = dto.seuil !== undefined ? Number(dto.seuil) : found.seuil;
    const priceCad =
      dto.priceCad !== undefined ? Number(dto.priceCad) : found.priceCad;
    const name = dto.name != null ? dto.name.trim() : found.name;
    const description =
      dto.description !== undefined
        ? dto.description.trim() || undefined
        : found.description;
    const statut = computeStatut(quantite, seuil);
    found.name = name;
    found.description = description;
    found.quantite = quantite;
    found.seuil = seuil;
    found.priceCad = priceCad;
    found.statut = statut;

    if (dto.categoryId !== undefined) {
      const categoryOid = await this.resolveDrinkCategoryId(dto.categoryId);
      found.set('category', categoryOid ?? null);
      found.markModified('category');
    }

    if (file?.buffer?.length) {
      const url = await this._mediasService.upload(
        file,
        user,
        `stores/${storeId}/drinks`,
      );
      if (found.imageUrl) {
        await this._mediasService.delete(found.imageUrl).catch(() => undefined);
      }
      found.imageUrl = url;
    } else if (dto.clearImage === true) {
      if (found.imageUrl) {
        await this._mediasService.delete(found.imageUrl).catch(() => undefined);
      }
      found.imageUrl = undefined;
    }

    await found.save();
    const populated = await this._drinkModel
      .findById(found._id)
      .populate('category', 'title kind isEnabled')
      .lean()
      .exec();
    await this._invalidateCategoryCountsCache();
    return mapDrinkDoc((populated ?? found.toObject()) as Record<string, unknown>);
  }

  async deleteForStore(storeId: string, drinkId: string, user: UserModel) {
    await this.assertStoreCatalogAccess(storeId, user, 'catalog.edit');
    await this.assertDrinkAccessibleForStore(storeId, drinkId);
    if (!Types.ObjectId.isValid(drinkId)) {
      throw new NotFoundException('drink_not_found');
    }
    const doc = await this._drinkModel
      .findOne({
        _id: new Types.ObjectId(drinkId),
        store: new Types.ObjectId(storeId),
      })
      .exec();
    if (!doc) {
      throw new NotFoundException('drink_not_found');
    }
    if (doc.imageUrl) {
      await this._mediasService.delete(doc.imageUrl).catch(() => undefined);
    }
    await doc.deleteOne();
    await this._invalidateCategoryCountsCache();
  }

  /**
   * Décrémente le stock boisson de façon atomique (commande payée / panier → commande).
   * Met à jour `statut` selon `quantite` vs `seuil`.
   */
  async tryConsumeStock(
    storeId: string,
    drinkId: string,
    qty: number,
  ): Promise<boolean> {
    const q = Math.floor(Number(qty));
    if (
      !Types.ObjectId.isValid(storeId) ||
      !Types.ObjectId.isValid(drinkId) ||
      q <= 0
    ) {
      return false;
    }
    const res = await this._drinkModel
      .updateOne(
        {
          _id: new Types.ObjectId(drinkId),
          store: new Types.ObjectId(storeId),
          quantite: { $gte: q },
        },
        { $inc: { quantite: -q } },
      )
      .exec();
    if (res.modifiedCount !== 1) {
      return false;
    }
    await this.syncStatutAfterQuantiteChange(new Types.ObjectId(drinkId));
    return true;
  }

  /** Annule une consommation (ex. échec après décrément, rollback commande). */
  async restoreStock(
    storeId: string,
    drinkId: string,
    qty: number,
  ): Promise<void> {
    const q = Math.floor(Number(qty));
    if (
      !Types.ObjectId.isValid(storeId) ||
      !Types.ObjectId.isValid(drinkId) ||
      q <= 0
    ) {
      return;
    }
    await this._drinkModel
      .updateOne(
        {
          _id: new Types.ObjectId(drinkId),
          store: new Types.ObjectId(storeId),
        },
        { $inc: { quantite: q } },
      )
      .exec();
    await this.syncStatutAfterQuantiteChange(new Types.ObjectId(drinkId));
  }

  private async syncStatutAfterQuantiteChange(drinkOid: Types.ObjectId) {
    await this._drinkModel
      .updateOne({ _id: drinkOid }, [
        {
          $set: {
            statut: {
              $cond: [
                { $lte: ['$quantite', '$seuil'] },
                DrinkStatutEnum.ALERTE,
                DrinkStatutEnum.OK,
              ],
            },
          },
        },
      ])
      .exec();
  }
}
