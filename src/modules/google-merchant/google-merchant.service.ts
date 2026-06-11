import { resolveProductPublicUrl } from '@modules/orders/order-invoice.util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { DrinkModel } from '@schemas/drink.schema';
import { ProductCategoryKindEnum } from '@schemas/product-category.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { Model, Types } from 'mongoose';
import {
  GOOGLE_MERCHANT_AVAILABILITY_IN_STOCK,
  GOOGLE_MERCHANT_AVAILABILITY_OUT_OF_STOCK,
  GOOGLE_MERCHANT_CONDITION_NEW,
  GOOGLE_MERCHANT_DRINK_ID_PREFIX,
  GOOGLE_MERCHANT_IDENTIFIER_EXISTS_NO,
  GOOGLE_PRODUCT_CATEGORY_BEVERAGES,
  GOOGLE_PRODUCT_CATEGORY_PREPARED_FOODS,
} from './google-merchant.constants';
import {
  buildGoogleMerchantExport,
  normalizeGoogleMerchantFormat,
  resolveGoogleMerchantPricePair,
} from './google-merchant-export.util';
import {
  GoogleMerchantExportFormat,
  GoogleMerchantExportResult,
  GoogleMerchantFeedItem,
} from './google-merchant.types';

type ProductVariantRow = {
  label: string;
  price: number;
  discountPrice: number;
};

type StoreFeedContext = {
  id: string;
  name: string;
  currency: string;
};

type ProductFeedContext = {
  productId: string;
  baseTitle: string;
  description: string;
  productLink: string;
  imageLink?: string;
  additionalImageLink?: string;
  googleProductCategory: string;
  productType: string;
  listPrice: number;
  discountPrice: number;
  currency: string;
  variants: ProductVariantRow[];
};

@Injectable()
export class GoogleMerchantService {
  constructor(
    @InjectModel(ProductModel.name)
    private readonly _productModel: Model<ProductModel>,
    @InjectModel(DrinkModel.name)
    private readonly _drinkModel: Model<DrinkModel>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    private readonly _config: ConfigService,
  ) {}

  async exportStoreFeed(
    formatRaw: string | undefined,
    storeIdRaw: string | undefined,
  ): Promise<GoogleMerchantExportResult> {
    const format = this.parseFormat(formatRaw);
    const storeId = storeIdRaw?.trim();
    if (!storeId || !Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException('invalid_store: store query param is required');
    }

    const store = await this._storeModel
      .findById(storeId)
      .select('name currency status')
      .lean()
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    const [products, drinks] = await Promise.all([
      this.fetchActiveProducts([storeId]),
      this.fetchDrinks([storeId]),
    ]);
    const publicWebUrl = this.resolvePublicWebUrl();
    const storeContext: StoreFeedContext = {
      id: storeId,
      name: String(store.name ?? 'Store'),
      currency: String(store.currency ?? 'CAD'),
    };
    const items = this.buildFeedItems(
      products as Record<string, unknown>[],
      drinks as Record<string, unknown>[],
      storeContext,
      publicWebUrl,
    );

    return this.buildExport(format, items, {
      filenameSlug: storeId,
      channel: {
        title: storeContext.name,
        link: `${publicWebUrl}/stores/${encodeURIComponent(storeId)}`,
        description: `Product feed for ${storeContext.name}`,
      },
    });
  }

  async exportAllStoresFeed(
    formatRaw: string | undefined,
  ): Promise<GoogleMerchantExportResult> {
    const format = this.parseFormat(formatRaw);
    const stores = await this._storeModel
      .find({ status: StoreStatusEnum.ACTIVE })
      .select('name currency')
      .lean()
      .exec();

    const storeContexts = new Map<string, StoreFeedContext>();
    const storeIds: string[] = [];
    for (const store of stores) {
      const id = String(store._id ?? '');
      if (!id) continue;
      storeIds.push(id);
      storeContexts.set(id, {
        id,
        name: String(store.name ?? 'Store'),
        currency: String(store.currency ?? 'CAD'),
      });
    }

    const [products, drinks] = await Promise.all([
      this.fetchActiveProducts(storeIds),
      this.fetchDrinks(storeIds),
    ]);
    const publicWebUrl = this.resolvePublicWebUrl();
    const items = this.buildFeedItems(
      products as Record<string, unknown>[],
      drinks as Record<string, unknown>[],
      null,
      publicWebUrl,
      storeContexts,
    );

    return this.buildExport(format, items, {
      filenameSlug: 'all-stores',
      channel: {
        title: 'Wise Eat — All stores',
        link: publicWebUrl,
        description: 'Product feed for all active stores',
      },
    });
  }

  private parseFormat(formatRaw: string | undefined): GoogleMerchantExportFormat {
    const format = normalizeGoogleMerchantFormat(formatRaw);
    if (!format) {
      throw new BadRequestException(
        'invalid_format: supported values are csv, xlsx, json, xml',
      );
    }
    return format;
  }

  private async fetchActiveProducts(storeIds: string[]) {
    if (!storeIds.length) return [];
    return this._productModel
      .find({
        store: { $in: storeIds },
        status: ProductStatusEnum.ACTIVE,
      })
      .populate({ path: 'category', select: 'title kind' })
      .select(
        'title bio about price discountPrice currency profileImage galleryImages variants variantsLabel status store category',
      )
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
  }

  private async fetchDrinks(storeIds: string[]) {
    if (!storeIds.length) return [];
    return this._drinkModel
      .find({ store: { $in: storeIds } })
      .populate({ path: 'category', select: 'title kind' })
      .select('name description priceCad quantite imageUrl store category updatedAt')
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
  }

  private buildFeedItems(
    products: Record<string, unknown>[],
    drinks: Record<string, unknown>[],
    singleStore: StoreFeedContext | null,
    publicWebUrl: string,
    storeContexts?: Map<string, StoreFeedContext>,
  ): GoogleMerchantFeedItem[] {
    const resolveStore = (storeId: string): StoreFeedContext | undefined => {
      if (singleStore) return singleStore;
      return storeContexts?.get(storeId);
    };

    const productItems = products.flatMap((product) => {
      const storeId = String(product.store ?? '');
      const store = resolveStore(storeId);
      if (!store) return [];
      return this.mapProductToFeedItems(product, store, publicWebUrl);
    });

    const drinkItems = drinks.flatMap((drink) => {
      const storeId = String(drink.store ?? '');
      const store = resolveStore(storeId);
      if (!store) return [];
      return this.mapDrinkToFeedItem(drink, store, publicWebUrl);
    });

    return [...productItems, ...drinkItems];
  }

  private async buildExport(
    format: GoogleMerchantExportFormat,
    items: GoogleMerchantFeedItem[],
    meta: {
      filenameSlug: string;
      channel: { title: string; link: string; description: string };
    },
  ): Promise<GoogleMerchantExportResult> {
    return buildGoogleMerchantExport(format, items, meta);
  }

  private resolvePublicWebUrl(): string {
    const url =
      this._config.get<string>('PUBLIC_WEB_URL')?.trim() ||
      this._config.get<string>('FRONTEND_URL')?.trim() ||
      'https://wise-eat.com';
    return url.replace(/\/+$/, '');
  }

  private mapProductToFeedItems(
    product: Record<string, unknown>,
    store: StoreFeedContext,
    publicWebUrl: string,
  ): GoogleMerchantFeedItem[] {
    const productId = String(product._id ?? '');
    const baseTitle = String(product.title ?? '').trim();
    const productLink =
      resolveProductPublicUrl(store.id, productId, publicWebUrl) ??
      `${publicWebUrl}/stores/${encodeURIComponent(store.id)}/products/${encodeURIComponent(productId)}`;
    const { main, additional } = this.resolveImageLinks(product);
    const categoryTitle = this.resolveCategoryTitle(product);
    const googleProductCategory = this.resolveGoogleProductCategory(product);
    const productType = this.buildProductType(store.name, categoryTitle);
    const currency = String(product.currency ?? store.currency ?? 'CAD');
    const variants = this.normalizeVariants(product.variants);

    const context: ProductFeedContext = {
      productId,
      baseTitle,
      description: this.buildDescription(product),
      productLink,
      imageLink: main,
      additionalImageLink: additional,
      googleProductCategory,
      productType,
      listPrice: Number(product.price ?? 0),
      discountPrice: Number(product.discountPrice ?? product.discount_price ?? 0),
      currency,
      variants,
    };

    if (!variants.length) {
      return [this.buildSingleItem(context, store)];
    }

    return variants.map((variant, index) =>
      this.buildVariantItem(context, store, variant, index),
    );
  }

  private mapDrinkToFeedItem(
    drink: Record<string, unknown>,
    store: StoreFeedContext,
    publicWebUrl: string,
  ): GoogleMerchantFeedItem {
    const drinkId = String(drink._id ?? '');
    const feedId = `${GOOGLE_MERCHANT_DRINK_ID_PREFIX}${drinkId}`.slice(0, 50);
    const title = String(drink.name ?? '').trim();
    const description =
      String(drink.description ?? '').trim() || title || 'Boisson';
    const categoryTitle = this.resolveCategoryTitle(drink) || 'Boissons';
    const productType = this.buildProductType(store.name, categoryTitle);
    const currency = store.currency || 'CAD';
    const priceCad = Number(drink.priceCad ?? drink.price_cad ?? 0);
    const quantite = Number(drink.quantite ?? 0);
    const drinkLink = this.resolveDrinkPublicUrl(store.id, drinkId, publicWebUrl);
    const imageUrl =
      typeof drink.imageUrl === 'string'
        ? drink.imageUrl
        : typeof drink.image_url === 'string'
        ? drink.image_url
        : '';
    const imageLink = this.isProductImageUrl(imageUrl) ? imageUrl : undefined;

    return this.buildFeedItem({
      id: feedId,
      title,
      description,
      link: drinkLink,
      mobileLink: drinkLink,
      imageLink,
      availability:
        quantite > 0
          ? GOOGLE_MERCHANT_AVAILABILITY_IN_STOCK
          : GOOGLE_MERCHANT_AVAILABILITY_OUT_OF_STOCK,
      price: resolveGoogleMerchantPricePair(priceCad, 0, currency).price,
      condition: GOOGLE_MERCHANT_CONDITION_NEW,
      brand: store.name,
      identifierExists: GOOGLE_MERCHANT_IDENTIFIER_EXISTS_NO,
      mpn: feedId,
      googleProductCategory: GOOGLE_PRODUCT_CATEGORY_BEVERAGES,
      productType,
      customLabel0: store.id,
      customLabel1: store.name,
    });
  }

  private resolveDrinkPublicUrl(
    storeId: string,
    drinkId: string,
    publicWebUrl: string,
  ): string {
    return `${publicWebUrl}/stores/${encodeURIComponent(storeId)}/drinks/${encodeURIComponent(drinkId)}`;
  }

  private buildSingleItem(
    context: ProductFeedContext,
    store: StoreFeedContext,
  ): GoogleMerchantFeedItem {
    const pricing = resolveGoogleMerchantPricePair(
      context.listPrice,
      context.discountPrice,
      context.currency,
    );
    return this.buildFeedItem({
      id: context.productId,
      title: context.baseTitle,
      description: context.description,
      link: context.productLink,
      mobileLink: context.productLink,
      imageLink: context.imageLink,
      additionalImageLink: context.additionalImageLink,
      availability: GOOGLE_MERCHANT_AVAILABILITY_IN_STOCK,
      price: pricing.price,
      salePrice: pricing.salePrice,
      condition: GOOGLE_MERCHANT_CONDITION_NEW,
      brand: store.name,
      identifierExists: GOOGLE_MERCHANT_IDENTIFIER_EXISTS_NO,
      mpn: context.productId,
      googleProductCategory: context.googleProductCategory,
      productType: context.productType,
      customLabel0: store.id,
      customLabel1: store.name,
    });
  }

  private buildVariantItem(
    context: ProductFeedContext,
    store: StoreFeedContext,
    variant: ProductVariantRow,
    index: number,
  ): GoogleMerchantFeedItem {
    const variantId = this.buildVariantFeedId(
      context.productId,
      variant.label,
      index,
    );
    const pricing = resolveGoogleMerchantPricePair(
      variant.price,
      variant.discountPrice,
      context.currency,
    );
    const title = variant.label
      ? `${context.baseTitle} - ${variant.label}`
      : context.baseTitle;

    return this.buildFeedItem({
      id: variantId,
      title,
      description: context.description,
      link: context.productLink,
      mobileLink: context.productLink,
      imageLink: context.imageLink,
      additionalImageLink: context.additionalImageLink,
      availability: GOOGLE_MERCHANT_AVAILABILITY_IN_STOCK,
      price: pricing.price,
      salePrice: pricing.salePrice,
      condition: GOOGLE_MERCHANT_CONDITION_NEW,
      brand: store.name,
      identifierExists: GOOGLE_MERCHANT_IDENTIFIER_EXISTS_NO,
      mpn: variantId,
      googleProductCategory: context.googleProductCategory,
      productType: context.productType,
      itemGroupId: context.productId,
      itemGroupTitle: context.baseTitle,
      size: variant.label || undefined,
      customLabel0: store.id,
      customLabel1: store.name,
    });
  }

  private buildFeedItem(item: GoogleMerchantFeedItem): GoogleMerchantFeedItem {
    const trimmed: GoogleMerchantFeedItem = {
      id: item.id.trim().slice(0, 50),
      title: item.title.trim().slice(0, 150),
      description: item.description.trim().slice(0, 5000),
      link: item.link.trim(),
      availability: item.availability,
      price: item.price,
      condition: item.condition,
      brand: item.brand.trim().slice(0, 70),
      identifierExists: item.identifierExists,
      mpn: item.mpn.trim().slice(0, 70),
      googleProductCategory: item.googleProductCategory,
      productType: item.productType.trim().slice(0, 750),
    };

    if (item.mobileLink?.trim()) trimmed.mobileLink = item.mobileLink.trim();
    if (item.imageLink?.trim()) trimmed.imageLink = item.imageLink.trim();
    if (item.additionalImageLink?.trim()) {
      trimmed.additionalImageLink = item.additionalImageLink.trim();
    }
    if (item.salePrice?.trim()) trimmed.salePrice = item.salePrice.trim();
    if (item.itemGroupId?.trim()) {
      trimmed.itemGroupId = item.itemGroupId.trim().slice(0, 50);
    }
    if (item.itemGroupTitle?.trim()) {
      trimmed.itemGroupTitle = item.itemGroupTitle.trim().slice(0, 150);
    }
    if (item.size?.trim()) trimmed.size = item.size.trim().slice(0, 100);
    if (item.customLabel0?.trim()) trimmed.customLabel0 = item.customLabel0.trim();
    if (item.customLabel1?.trim()) {
      trimmed.customLabel1 = item.customLabel1.trim().slice(0, 100);
    }

    return trimmed;
  }

  private buildProductType(storeName: string, categoryTitle: string): string {
    const store = storeName.trim() || 'Store';
    if (!categoryTitle) return store;
    return `${store} > ${categoryTitle}`;
  }

  private resolveCategoryTitle(product: Record<string, unknown>): string {
    const cat = product.category as Record<string, unknown> | undefined;
    if (cat && typeof cat.title === 'string') return cat.title.trim();
    return '';
  }

  private resolveGoogleProductCategory(product: Record<string, unknown>): string {
    const cat = product.category as Record<string, unknown> | undefined;
    const kind = String(cat?.kind ?? ProductCategoryKindEnum.FOOD).toLowerCase();
    if (kind === ProductCategoryKindEnum.DRINK) {
      return GOOGLE_PRODUCT_CATEGORY_BEVERAGES;
    }
    return GOOGLE_PRODUCT_CATEGORY_PREPARED_FOODS;
  }

  private buildDescription(product: Record<string, unknown>): string {
    const about = String(product.about ?? '').trim();
    if (about) return about;
    return String(product.bio ?? '').trim() || String(product.title ?? '').trim();
  }

  private resolveImageLinks(product: Record<string, unknown>): {
    main?: string;
    additional?: string;
  } {
    const urls: string[] = [];
    const profile =
      typeof product.profileImage === 'string'
        ? product.profileImage
        : typeof product.profile_image === 'string'
        ? product.profile_image
        : '';
    if (this.isProductImageUrl(profile)) urls.push(profile);

    const gallery = product.galleryImages ?? product.gallery_images;
    if (Array.isArray(gallery)) {
      for (const row of gallery) {
        const item = (row ?? {}) as Record<string, unknown>;
        const url =
          typeof item.imageUrl === 'string'
            ? item.imageUrl
            : typeof item.image_url === 'string'
            ? item.image_url
            : '';
        if (this.isProductImageUrl(url) && !urls.includes(url)) {
          urls.push(url);
        }
      }
    }

    if (!urls.length) return {};
    const [main, ...rest] = urls;
    return {
      main,
      additional: rest.slice(0, 10).join(','),
    };
  }

  private isProductImageUrl(value: string): boolean {
    return value.startsWith('https://') || value.startsWith('http://');
  }

  private normalizeVariants(raw: unknown): ProductVariantRow[] {
    if (!Array.isArray(raw)) return [];
    const items: ProductVariantRow[] = [];
    for (const row of raw) {
      const r = (row ?? {}) as Record<string, unknown>;
      const label = String(r.label ?? r.name ?? '').trim();
      const price = Number(r.price ?? 0);
      const discountPrice = Number(r.discountPrice ?? r.discount_price ?? 0);
      if (!label && !Number.isFinite(price)) continue;
      items.push({
        label,
        price: Number.isFinite(price) ? price : 0,
        discountPrice: Number.isFinite(discountPrice) ? discountPrice : 0,
      });
    }
    return items;
  }

  private buildVariantFeedId(
    productId: string,
    label: string,
    index: number,
  ): string {
    const slug =
      label
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || String(index + 1);
    return `${productId}-${slug}`.slice(0, 50);
  }
}
