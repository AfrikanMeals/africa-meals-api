import {
  pipelineActiveStoresWithStripeOnboarded,
  productEmbeddedStoreOwnerStripeOnboardedStages,
} from '@modules/billing/stripe/stripe-connect-visibility';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { Model, PipelineStage } from 'mongoose';
import {
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
      { $project: { _id: 1, name: 1, updatedAt: 1 } },
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
          rows?: Array<{ _id?: unknown; name?: unknown; updatedAt?: Date }>;
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
      { $project: { _id: 1, title: 1, updatedAt: 1, store: '$store._id' } },
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
            updatedAt?: Date;
            store?: unknown;
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
          title: String(row.title ?? 'Produit').trim() || 'Produit',
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
}
