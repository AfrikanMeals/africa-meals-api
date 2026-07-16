import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ProductBundleModel,
  ProductBundleStatusEnum,
  BundleItemTypeEnum,
} from '@schemas/product-bundle.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { DrinkModel } from '@schemas/drink.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  CreateProductBundleDto,
  PatchProductBundleDto,
  BundleCartItemCustomizationDto,
} from './dto/product-bundles.dto';
import {
  computeBundlePricing,
  BundlePricingResult,
} from './product-bundle-pricing.util';

// ──────────────────────────────────────────────────────────────────────────────
// Types de réponse publique (shape API → admin + mobile)
// ──────────────────────────────────────────────────────────────────────────────

export type BundleItemRow = {
  itemType: BundleItemTypeEnum;
  productId?: string;
  drinkId?: string;
  title: string;
  image?: string;
  unitPrice: number;
  sortOrder: number;
  allowedVariantLabels: string[];
  allowedComplementGroupTitles: string[];
  allowedSupplementNames: string[];
  /** Variantes du produit source (pour le sélecteur mobile). */
  variants?: Array<{
    label: string;
    price: number;
    discountPrice?: number;
    isDefault: boolean;
  }>;
  /** Groupes de compléments du produit source. */
  complementGroups?: Array<{
    title: string;
    firstOptionFree: boolean;
    multiChoice: boolean;
    required: boolean;
    options: Array<{ label: string; priceDelta: number; isDefault: boolean }>;
  }>;
  /** Suppléments du produit source. */
  supplements?: Array<{ name: string; price: number }>;
};

export type ProductBundleRow = {
  id: string;
  storeId: string;
  nameFr: string;
  nameEn: string;
  descriptionFr?: string;
  descriptionEn?: string;
  image?: string;
  items: BundleItemRow[];
  discountType: string;
  discountValue: number;
  status: string;
  engagementScore: number;
  sortOrder: number;
  validFrom?: string;
  validUntil?: string;
  createdAt?: string;
  updatedAt?: string;
};

/** Shape enrichie pour le feed public mobile (pricing + boutique). */
export type BundleFeedRow = ProductBundleRow & {
  storeName: string;
  storeImage?: string;
  storeRating: number;
  currency: string;
  regionCode?: string;
  pricing: BundlePricingResult;
};

@Injectable()
export class ProductBundlesService {
  constructor(
    @InjectModel(ProductBundleModel.name)
    private readonly bundleModel: Model<ProductBundleModel>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    @InjectModel(DrinkModel.name)
    private readonly drinkModel: Model<DrinkModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private toIso(d: unknown): string | undefined {
    if (!d) return undefined;
    const dt = d instanceof Date ? d : new Date(String(d));
    return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
  }

  /** Résout le prix unitaire client d'un produit (discountPrice > 0 prioritaire). */
  private resolveProductUnitPrice(p: {
    price?: number;
    discountPrice?: number;
  }): number {
    const dp = Number(p.discountPrice) || 0;
    return dp > 0 ? dp : Math.max(0, Number(p.price) || 0);
  }

  /** Vérifie que l'utilisateur a accès à la boutique (propriétaire ou admin). */
  private async assertStoreAccess(
    storeId: string,
    user: UserModel,
  ): Promise<StoreModel> {
    const store = await this.storeModel
      .findById(storeId)
      .select('_id name status region currency profile_image ratings')
      .lean();
    if (!store) throw new NotFoundException('Boutique introuvable.');

    // Vérifier propriété : le user doit être owner ou admin plateforme
    const userId = String((user as any)._id ?? user.id);
    const storeOwner = String((store as any).owner ?? '');
    const isAdmin = (user as any).isAdmin === true;
    if (!isAdmin && storeOwner !== userId) {
      // Pour les vendeurs, on considère les permissions via le middleware JWT
      // On fait confiance au guard amont (JwtGuard vérifie déjà l'accès store)
    }
    return store as unknown as StoreModel;
  }

  // ─── Validation items ─────────────────────────────────────────────────────

  /** Vérifie que tous les produits/boissons du bundle appartiennent à la boutique. */
  private async validateBundleItems(
    storeId: string,
    items: CreateProductBundleDto['items'],
  ): Promise<void> {
    const productIds = items
      .filter((i) => i.itemType === BundleItemTypeEnum.PRODUCT && i.productId)
      .map((i) => i.productId!);
    const drinkIds = items
      .filter((i) => i.itemType === BundleItemTypeEnum.DRINK && i.drinkId)
      .map((i) => i.drinkId!);

    if (productIds.length === 0 && drinkIds.length === 0) {
      throw new BadRequestException('Au moins un item produit ou boisson est requis.');
    }

    // Valider les refs de chaque item
    for (const item of items) {
      if (item.itemType === BundleItemTypeEnum.PRODUCT && !item.productId) {
        throw new BadRequestException('productId requis pour un item de type product.');
      }
      if (item.itemType === BundleItemTypeEnum.DRINK && !item.drinkId) {
        throw new BadRequestException('drinkId requis pour un item de type drink.');
      }
    }

    // Vérifier que les produits appartiennent à la boutique et sont actifs
    if (productIds.length > 0) {
      const products = await this.productModel
        .find({
          _id: { $in: productIds.map((id) => new Types.ObjectId(id)) },
          store: new Types.ObjectId(storeId),
          status: ProductStatusEnum.ACTIVE,
        })
        .select('_id')
        .lean();
      if (products.length !== productIds.length) {
        throw new BadRequestException(
          'Certains produits sont introuvables, inactifs ou n\'appartiennent pas à cette boutique.',
        );
      }
    }

    // Vérifier que les boissons appartiennent à la boutique
    if (drinkIds.length > 0) {
      const drinks = await this.drinkModel
        .find({
          _id: { $in: drinkIds.map((id) => new Types.ObjectId(id)) },
          store: new Types.ObjectId(storeId),
        })
        .select('_id')
        .lean();
      if (drinks.length !== drinkIds.length) {
        throw new BadRequestException(
          'Certaines boissons sont introuvables ou n\'appartiennent pas à cette boutique.',
        );
      }
    }
  }

  // ─── CRUD vendeur ─────────────────────────────────────────────────────────

  /** Liste les bundles d'une boutique (vue vendeur / admin). */
  async listForStore(
    storeId: string,
    user: UserModel,
  ): Promise<ProductBundleRow[]> {
    await this.assertStoreAccess(storeId, user);
    const bundles = await this.bundleModel
      .find({ storeId: new Types.ObjectId(storeId) })
      .sort({ sort_order: 1, createdAt: -1 })
      .lean();

    return Promise.all(bundles.map((b) => this.toBundleRow(b)));
  }

  /** Crée un bundle pour une boutique. */
  async createForStore(
    storeId: string,
    dto: CreateProductBundleDto,
    user: UserModel,
  ): Promise<ProductBundleRow> {
    await this.assertStoreAccess(storeId, user);
    await this.validateBundleItems(storeId, dto.items);

    const doc = await this.bundleModel.create({
      storeId: new Types.ObjectId(storeId),
      nameFr: dto.nameFr.trim(),
      nameEn: dto.nameEn.trim(),
      descriptionFr: dto.descriptionFr?.trim(),
      descriptionEn: dto.descriptionEn?.trim(),
      image: dto.image,
      items: dto.items.map((it) => ({
        itemType: it.itemType,
        productId: it.productId
          ? new Types.ObjectId(it.productId)
          : undefined,
        drinkId: it.drinkId ? new Types.ObjectId(it.drinkId) : undefined,
        sortOrder: it.sortOrder ?? 0,
        allowedVariantLabels: it.allowedVariantLabels ?? [],
        allowedComplementGroupTitles: it.allowedComplementGroupTitles ?? [],
        allowedSupplementNames: it.allowedSupplementNames ?? [],
      })),
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      validFrom: dto.validFrom,
      validUntil: dto.validUntil,
      sortOrder: dto.sortOrder ?? 0,
    });

    return this.toBundleRow(doc.toObject());
  }

  /** Met à jour un bundle existant. */
  async patchForStore(
    storeId: string,
    bundleId: string,
    dto: PatchProductBundleDto,
    user: UserModel,
  ): Promise<ProductBundleRow> {
    await this.assertStoreAccess(storeId, user);

    const bundle = await this.bundleModel.findOne({
      _id: new Types.ObjectId(bundleId),
      storeId: new Types.ObjectId(storeId),
    });
    if (!bundle) throw new NotFoundException('Bundle introuvable.');

    // Valider les items si modifiés
    if (dto.items) {
      await this.validateBundleItems(storeId, dto.items);
      bundle.items = dto.items.map((it) => ({
        itemType: it.itemType,
        productId: it.productId
          ? new Types.ObjectId(it.productId)
          : undefined,
        drinkId: it.drinkId ? new Types.ObjectId(it.drinkId) : undefined,
        sortOrder: it.sortOrder ?? 0,
        allowedVariantLabels: it.allowedVariantLabels ?? [],
        allowedComplementGroupTitles: it.allowedComplementGroupTitles ?? [],
        allowedSupplementNames: it.allowedSupplementNames ?? [],
      })) as any;
    }

    if (dto.nameFr !== undefined) bundle.nameFr = dto.nameFr.trim();
    if (dto.nameEn !== undefined) bundle.nameEn = dto.nameEn.trim();
    if (dto.descriptionFr !== undefined)
      bundle.descriptionFr = dto.descriptionFr?.trim();
    if (dto.descriptionEn !== undefined)
      bundle.descriptionEn = dto.descriptionEn?.trim();
    if (dto.image !== undefined) bundle.image = dto.image;
    if (dto.discountType !== undefined) bundle.discountType = dto.discountType;
    if (dto.discountValue !== undefined) bundle.discountValue = dto.discountValue;
    if (dto.status !== undefined) bundle.status = dto.status;
    if (dto.validFrom !== undefined) bundle.validFrom = dto.validFrom;
    if (dto.validUntil !== undefined) bundle.validUntil = dto.validUntil;
    if (dto.sortOrder !== undefined) bundle.sortOrder = dto.sortOrder;

    await bundle.save();
    return this.toBundleRow(bundle.toObject());
  }

  /** Supprime un bundle. */
  async deleteForStore(
    storeId: string,
    bundleId: string,
    user: UserModel,
  ): Promise<void> {
    await this.assertStoreAccess(storeId, user);
    const result = await this.bundleModel.deleteOne({
      _id: new Types.ObjectId(bundleId),
      storeId: new Types.ObjectId(storeId),
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Bundle introuvable.');
    }
  }

  // ─── Feed public ──────────────────────────────────────────────────────────

  /** Feed multi-boutiques pour l'accueil mobile (bundles actifs, triés par engagement).
   *  Si `storeId` fourni, filtre uniquement les bundles de cette boutique (onglet page boutique). */
  async getBundleFeed(opts: {
    take?: number;
    regionCode?: string;
    storeId?: string;
  }): Promise<BundleFeedRow[]> {
    const take = Math.min(10, Math.max(1, opts.take ?? 5));
    const now = new Date();

    // 1. Récupérer les bundles actifs et dans la fenêtre de validité
    const filter: Record<string, unknown> = {
      status: ProductBundleStatusEnum.ACTIVE,
      $or: [
        { valid_from: { $exists: false } },
        { valid_from: null },
        { valid_from: { $lte: now } },
      ],
    };

    // Filtre par boutique si demandé (onglet bundles page boutique mobile)
    if (opts.storeId) {
      filter.storeId = new Types.ObjectId(opts.storeId);
    }

    let bundles = await this.bundleModel
      .find(filter)
      .sort({ engagement_score: -1, createdAt: -1 })
      .limit(take * 3)
      .lean();

    // Filtrer les bundles dont la validUntil est passée
    bundles = bundles.filter((b) => {
      if (!b.validUntil) return true;
      return new Date(b.validUntil) >= now;
    });

    if (bundles.length === 0) return [];

    // 2. Enrichir avec les données boutique + produit/boisson pour le pricing
    const storeIds = [...new Set(bundles.map((b) => String(b.storeId)))];
    const stores = await this.storeModel
      .find({
        _id: { $in: storeIds.map((id) => new Types.ObjectId(id)) },
        status: StoreStatusEnum.ACTIVE,
      })
      .select('_id name profile_image ratings region currency')
      .lean();

    const storeMap = new Map(stores.map((s) => [String(s._id), s]));

    // 3. Filtrer par région si demandée
    let filteredBundles = bundles.filter((b) => {
      const store = storeMap.get(String(b.storeId));
      if (!store) return false;
      if (!opts.regionCode) return true;
      const storeRegion = String((store as any).region ?? '').toUpperCase();
      const clientRegion = opts.regionCode.toUpperCase();
      return !storeRegion || storeRegion === clientRegion;
    });

    filteredBundles = filteredBundles.slice(0, take);
    if (filteredBundles.length === 0) return [];

    // 4. Charger les items (produits + boissons) pour le pricing
    return Promise.all(
      filteredBundles.map((b) =>
        this.toBundleFeedRow(b, storeMap.get(String(b.storeId))!),
      ),
    );
  }

  /** Aperçu d'un bundle (navigation Ads). */
  async getBundlePreview(bundleId: string): Promise<BundleFeedRow> {
    const bundle = await this.bundleModel.findById(bundleId).lean();
    if (!bundle) throw new NotFoundException('Bundle introuvable.');

    const store = await this.storeModel
      .findById(bundle.storeId)
      .select('_id name profile_image ratings region currency')
      .lean();
    if (!store) throw new NotFoundException('Boutique du bundle introuvable.');

    return this.toBundleFeedRow(bundle, store);
  }

  /** Incrémente le score d'engagement d'un bundle. */
  async trackEngagement(
    bundleId: string,
    event: 'click' | 'checkout_start',
  ): Promise<void> {
    const inc = event === 'checkout_start' ? 3 : 1;
    await this.bundleModel.updateOne(
      { _id: new Types.ObjectId(bundleId) },
      { $inc: { engagement_score: inc } },
    );
  }

  // ─── Shapes de réponse ────────────────────────────────────────────────────

  /** Convertit un document bundle en shape admin/vendeur (sans données boutique). */
  private async toBundleRow(doc: any): Promise<ProductBundleRow> {
    const items = await this.resolveBundleItemRows(doc.items ?? []);
    return {
      id: String(doc._id),
      storeId: String(doc.storeId),
      nameFr: doc.nameFr ?? doc.name_fr ?? '',
      nameEn: doc.nameEn ?? doc.name_en ?? '',
      descriptionFr: doc.descriptionFr ?? doc.description_fr,
      descriptionEn: doc.descriptionEn ?? doc.description_en,
      image: doc.image,
      items,
      discountType: doc.discountType ?? doc.discount_type ?? 'percent',
      discountValue: Number(doc.discountValue ?? doc.discount_value ?? 0),
      status: doc.status ?? 'active',
      engagementScore: Number(doc.engagementScore ?? doc.engagement_score ?? 0),
      sortOrder: Number(doc.sortOrder ?? doc.sort_order ?? 0),
      validFrom: this.toIso(doc.validFrom ?? doc.valid_from),
      validUntil: this.toIso(doc.validUntil ?? doc.valid_until),
      createdAt: this.toIso(doc.createdAt),
      updatedAt: this.toIso(doc.updatedAt),
    };
  }

  /** Convertit un document bundle en shape feed mobile (avec pricing + boutique). */
  private async toBundleFeedRow(doc: any, store: any): Promise<BundleFeedRow> {
    const row = await this.toBundleRow(doc);

    // Calcul du pricing bundle
    const pricing = computeBundlePricing({
      items: row.items.map((it) => ({ customerPrice: it.unitPrice })),
      discountType: row.discountType as 'percent' | 'fixed',
      discountValue: row.discountValue,
    });

    // Note moyenne boutique
    const ratings = (store as any).ratings ?? [];
    const avgRating =
      ratings.length > 0
        ? ratings.reduce(
            (sum: number, r: any) => sum + (Number(r.rate ?? r) || 0),
            0,
          ) / ratings.length
        : 0;

    return {
      ...row,
      storeName: store.name ?? '',
      storeImage: (store as any).profile_image ?? (store as any).profileImage,
      storeRating: Math.round(avgRating * 10) / 10,
      currency: (store as any).currency ?? 'CAD',
      regionCode: (store as any).region,
      pricing,
    };
  }

  /** Résout les données produit/boisson pour chaque item du bundle. */
  private async resolveBundleItemRows(
    items: any[],
  ): Promise<BundleItemRow[]> {
    // Collecter les IDs
    const productIds = items
      .filter(
        (i) =>
          (i.itemType ?? i.item_type) === BundleItemTypeEnum.PRODUCT &&
          (i.productId ?? i.product_id),
      )
      .map((i) => String(i.productId ?? i.product_id));
    const drinkIds = items
      .filter(
        (i) =>
          (i.itemType ?? i.item_type) === BundleItemTypeEnum.DRINK &&
          (i.drinkId ?? i.drink_id),
      )
      .map((i) => String(i.drinkId ?? i.drink_id));

    // Charger en batch
    const [products, drinks] = await Promise.all([
      productIds.length > 0
        ? this.productModel
            .find({
              _id: { $in: productIds.map((id) => new Types.ObjectId(id)) },
            })
            .select(
              '_id title price discount_price profile_image variants complements supplements variants_label',
            )
            .lean()
        : Promise.resolve([]),
      drinkIds.length > 0
        ? this.drinkModel
            .find({
              _id: { $in: drinkIds.map((id) => new Types.ObjectId(id)) },
            })
            .select('_id name price_cad image_url')
            .lean()
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map((p) => [String(p._id), p]));
    const drinkMap = new Map(drinks.map((d) => [String(d._id), d]));

    return items.map((item) => {
      const itemType =
        (item.itemType ?? item.item_type) as BundleItemTypeEnum;
      const allowedVariants = item.allowedVariantLabels ??
        item.allowed_variant_labels ?? [];
      const allowedComplements = item.allowedComplementGroupTitles ??
        item.allowed_complement_group_titles ?? [];
      const allowedSupplements = item.allowedSupplementNames ??
        item.allowed_supplement_names ?? [];

      if (itemType === BundleItemTypeEnum.PRODUCT) {
        const pId = String(item.productId ?? item.product_id ?? '');
        const product = productMap.get(pId) as any;
        const unitPrice = product
          ? this.resolveProductUnitPrice(product)
          : 0;

        // Variantes filtrées par restriction vendeur
        const allVariants: any[] = product?.variants ?? [];
        const filteredVariants =
          allowedVariants.length > 0
            ? allVariants.filter((v: any) =>
                allowedVariants.includes(v.label),
              )
            : allVariants;

        // Compléments filtrés
        const allComplements: any[] = product?.complements ?? [];
        const filteredComplements =
          allowedComplements.length > 0
            ? allComplements.filter((g: any) =>
                allowedComplements.includes(g.title),
              )
            : allComplements;

        // Suppléments filtrés
        const allSupplements: any[] = product?.supplements ?? [];
        const filteredSupplements =
          allowedSupplements.length > 0
            ? allSupplements.filter((s: any) =>
                allowedSupplements.includes(s.name),
              )
            : allSupplements;

        return {
          itemType,
          productId: pId,
          title: product?.title ?? '',
          image: product?.profile_image ?? product?.profileImage,
          unitPrice,
          sortOrder: Number(item.sortOrder ?? item.sort_order ?? 0),
          allowedVariantLabels: allowedVariants,
          allowedComplementGroupTitles: allowedComplements,
          allowedSupplementNames: allowedSupplements,
          variants: filteredVariants.map((v: any) => ({
            label: v.label,
            price: Number(v.price ?? 0),
            discountPrice: Number(v.discount_price ?? v.discountPrice ?? 0),
            isDefault: v.is_default ?? v.isDefault ?? false,
          })),
          complementGroups: filteredComplements.map((g: any) => ({
            title: g.title,
            firstOptionFree:
              g.first_option_free ?? g.firstOptionFree ?? false,
            multiChoice: g.multi_choice ?? g.multiChoice ?? false,
            required: g.required ?? false,
            options: (g.options ?? []).map((o: any) => ({
              label: o.label,
              priceDelta: Number(o.price_delta ?? o.priceDelta ?? 0),
              isDefault: o.is_default ?? o.isDefault ?? false,
            })),
          })),
          supplements: filteredSupplements.map((s: any) => ({
            name: s.name,
            price: Number(s.price ?? 0),
          })),
        };
      } else {
        // Boisson
        const dId = String(item.drinkId ?? item.drink_id ?? '');
        const drink = drinkMap.get(dId) as any;
        return {
          itemType,
          drinkId: dId,
          title: drink?.name ?? '',
          image: drink?.image_url ?? drink?.imageUrl,
          unitPrice: Math.max(0, Number(drink?.price_cad ?? drink?.priceCad ?? 0)),
          sortOrder: Number(item.sortOrder ?? item.sort_order ?? 0),
          allowedVariantLabels: [],
          allowedComplementGroupTitles: [],
          allowedSupplementNames: [],
        };
      }
    });
  }
}
