import {
  pipelineActiveStoresWithStripeOnboarded,
  productEmbeddedStoreOwnerStripeOnboardedStages,
} from '@modules/billing/stripe/stripe-connect-visibility';
import { DRINK_IN_STOCK_FILTER } from '@modules/drinks/drinks.service';
import { catalogModerationNotBlockedFilter } from '@common/moderation/catalog-moderation.util';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DrinkModel } from '@schemas/drink.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { Model, PipelineStage } from 'mongoose';
import {
  SeoSitemapDrinkRow,
  SeoSitemapPageResult,
  SeoSitemapProductRow,
  SeoSitemapStoreRow,
} from './public-seo.types';

@Injectable()
export class PublicSeoService {
  constructor(
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    @InjectModel(ProductModel.name)
    private readonly _productModel: Model<ProductModel>,
    @InjectModel(DrinkModel.name)
    private readonly _drinkModel: Model<DrinkModel>,
  ) {}

  async listSitemapStores(
    pageRaw?: string,
    limitRaw?: string,
  ): Promise<SeoSitemapPageResult<SeoSitemapStoreRow>> {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    const limit = Math.min(
      5000,
      Math.max(1, parseInt(limitRaw ?? '1000', 10) || 1000),
    );
    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      ...pipelineActiveStoresWithStripeOnboarded(),
      { $project: { _id: 1, name: 1, bio: 1, profileImage: 1, updatedAt: 1 } },
      { $sort: { updatedAt: -1, _id: 1 } },
      {
        $facet: {
          total: [{ $count: 'n' }],
          rows: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const bucket = (await this._storeModel.aggregate(pipeline).exec())[0] as
      | {
          total?: Array<{ n?: number }>;
          rows?: Array<{ _id?: unknown; name?: unknown; bio?: unknown; profileImage?: unknown; updatedAt?: Date }>;
        }
      | undefined;

    const total = bucket?.total?.[0]?.n ?? 0;
    const rows = bucket?.rows ?? [];
    const items = rows
      .map((row) => {
        const id = String(row._id ?? '').trim();
        if (!id) return null;
        return {
          id,
          name: String(row.name ?? 'Restaurant').trim() || 'Restaurant',
          bio:
            typeof row.bio === 'string' && row.bio.trim()
              ? row.bio.trim()
              : null,
          profileImage:
            typeof row.profileImage === 'string' && row.profileImage.trim()
              ? row.profileImage.trim()
              : null,
          updatedAt: row.updatedAt?.toISOString(),
        } satisfies SeoSitemapStoreRow;
      })
      .filter(Boolean) as SeoSitemapStoreRow[];

    return {
      items,
      page,
      limit,
      total,
      totalPages: total > 0 ? Math.ceil(total / limit) : 0,
    };
  }

  async listSitemapProducts(
    pageRaw?: string,
    limitRaw?: string,
  ): Promise<SeoSitemapPageResult<SeoSitemapProductRow>> {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    const limit = Math.min(
      5000,
      Math.max(1, parseInt(limitRaw ?? '1000', 10) || 1000),
    );
    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      { $match: { status: ProductStatusEnum.ACTIVE } },
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
          'store.acceptsOrders': { $ne: false },
        },
      },
      ...productEmbeddedStoreOwnerStripeOnboardedStages(),
      { $project: { _id: 1, title: 1, about: 1, profileImage: 1, updatedAt: 1, store: '$store._id', storeName: '$store.name' } },
      { $sort: { updatedAt: -1, _id: 1 } },
      {
        $facet: {
          total: [{ $count: 'n' }],
          rows: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const bucket = (await this._productModel.aggregate(pipeline).exec())[0] as
      | {
          total?: Array<{ n?: number }>;
          rows?: Array<{
            _id?: unknown;
            title?: unknown;
            about?: unknown;
            profileImage?: unknown;
            updatedAt?: Date;
            store?: unknown;
            storeName?: unknown;
          }>;
        }
      | undefined;

    const total = bucket?.total?.[0]?.n ?? 0;
    const rows = bucket?.rows ?? [];
    const items = rows
      .map((row) => {
        const id = String(row._id ?? '').trim();
        const storeId = String(row.store ?? '').trim();
        if (!id || !storeId) return null;
        return {
          id,
          storeId,
          storeName:
            typeof row.storeName === 'string' && row.storeName.trim()
              ? row.storeName.trim()
              : undefined,
          title: String(row.title ?? 'Produit').trim() || 'Produit',
          about:
            typeof row.about === 'string' && row.about.trim()
              ? row.about.trim()
              : null,
          profileImage:
            typeof row.profileImage === 'string' && row.profileImage.trim()
              ? row.profileImage.trim()
              : null,
          updatedAt: row.updatedAt?.toISOString(),
        } satisfies SeoSitemapProductRow;
      })
      .filter(Boolean) as SeoSitemapProductRow[];

    return {
      items,
      page,
      limit,
      total,
      totalPages: total > 0 ? Math.ceil(total / limit) : 0,
    };
  }

  async listSitemapDrinks(
    pageRaw?: string,
    limitRaw?: string,
  ): Promise<SeoSitemapPageResult<SeoSitemapDrinkRow>> {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    const limit = Math.min(
      5000,
      Math.max(1, parseInt(limitRaw ?? '1000', 10) || 1000),
    );
    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      { $match: { ...DRINK_IN_STOCK_FILTER, ...catalogModerationNotBlockedFilter() } },
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
          'store.acceptsOrders': { $ne: false },
        },
      },
      ...productEmbeddedStoreOwnerStripeOnboardedStages(),
      {
        $project: {
          _id: 1,
          name: 1,
          description: 1,
          imageUrl: 1,
          updatedAt: 1,
          store: '$store._id',
          storeName: '$store.name',
        },
      },
      { $sort: { updatedAt: -1, _id: 1 } },
      {
        $facet: {
          total: [{ $count: 'n' }],
          rows: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const bucket = (await this._drinkModel.aggregate(pipeline).exec())[0] as
      | {
          total?: Array<{ n?: number }>;
          rows?: Array<{
            _id?: unknown;
            name?: unknown;
            description?: unknown;
            imageUrl?: unknown;
            updatedAt?: Date;
            store?: unknown;
            storeName?: unknown;
          }>;
        }
      | undefined;

    const total = bucket?.total?.[0]?.n ?? 0;
    const rows = bucket?.rows ?? [];
    const items = rows
      .map((row) => {
        const id = String(row._id ?? '').trim();
        const storeId = String(row.store ?? '').trim();
        if (!id || !storeId) return null;
        const imageRaw =
          row.imageUrl != null ? String(row.imageUrl).trim() : '';
        return {
          id,
          storeId,
          storeName:
            typeof row.storeName === 'string' && row.storeName.trim()
              ? row.storeName.trim()
              : undefined,
          name: String(row.name ?? 'Boisson').trim() || 'Boisson',
          description:
            typeof row.description === 'string' && row.description.trim()
              ? row.description.trim()
              : null,
          imageUrl:
            imageRaw.startsWith('http://') || imageRaw.startsWith('https://')
              ? imageRaw
              : null,
          updatedAt: row.updatedAt?.toISOString(),
        } satisfies SeoSitemapDrinkRow;
      })
      .filter(Boolean) as SeoSitemapDrinkRow[];

    return {
      items,
      page,
      limit,
      total,
      totalPages: total > 0 ? Math.ceil(total / limit) : 0,
    };
  }
}
