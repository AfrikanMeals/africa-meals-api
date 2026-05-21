import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductModel } from '@schemas/product.schema';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import { StoreModel } from '@schemas/store.schema';
import { StoreRatingModel } from '@schemas/store_rating.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, PipelineStage, Types } from 'mongoose';
import { DEMO_PRODUCT_RATER_EMAIL_RE } from './demo-product-rating-users';
import { CreateRatingDto } from './dto/ratings.dto';
import type {
  LandingProductReviewItem,
  LandingProductReviewsResponse,
} from './dto/landing-product-review.dto';
import type {
  ProductReviewPublicRow,
  ProductReviewsPageResponse,
} from './dto/product-reviews-page.dto';
import type {
  StoreReviewPublicRow,
  StoreReviewsPageResponse,
} from './dto/store-reviews-page.dto';

@Injectable()
export class RatingsService {
  @InjectModel(ProductRatingModel.name)
  private readonly _productRatingModel: Model<ProductRatingModel>;
  @InjectModel(StoreRatingModel.name)
  private readonly _storeRatingModel: Model<StoreRatingModel>;

  async hasRatedProduct(product: ProductModel, user: UserModel) {
    return (
      (await this._productRatingModel
        .countDocuments({ product: product.id, user: user.id })
        .exec()) > 0
    );
  }

  async hasRatedStore(store: StoreModel, user: UserModel) {
    return (
      (await this._storeRatingModel
        .countDocuments({ store: store.id, user: user.id })
        .exec()) > 0
    );
  }

  async createProductRating(
    args: CreateRatingDto,
    product: ProductModel,
    user: UserModel,
  ) {
    const exists = await this.hasRatedProduct(product, user);
    if (exists) {
      throw new ConflictException('already_rated');
    }

    return this._productRatingModel.create({
      ...args,
      product: product.id,
      user: user.id,
    });
  }

  async createStoreRating(
    args: CreateRatingDto,
    store: StoreModel,
    user: UserModel,
  ) {
    const exists = await this.hasRatedStore(store, user);
    if (exists) {
      throw new ConflictException('already_rated');
    }

    return this._storeRatingModel.create({
      ...args,
      store: store.id,
      user: user.id,
    });
  }

  /**
   * Avis produits (notes ≥ 4, commentaire lisible) pour le site vitrine — sans JWT.
   * Noms légers (prénom + initiale) ; pas d’e-mail ; exclut les comptes de seed démo.
   */
  /**
   * Avis d’un plat, tri récents d’abord — **public** (fiche produit app / web).
   * Pagination seule : pas de populate lourd hors `user` minimal.
   */
  async listProductReviewsPaginated(
    productId: string,
    opts: { page: number; take: number },
  ): Promise<ProductReviewsPageResponse> {
    const { page, take } = opts;
    if (!Types.ObjectId.isValid(productId)) {
      return { items: [], total: 0, page, take, hasMore: false };
    }
    const oid = new Types.ObjectId(productId);
    const skip = (page - 1) * take;

    /** Avis réels uniquement : exclut les comptes démo seed (`demo-product-rating-users`). */
    const pipeline: PipelineStage[] = [
      { $match: { product: oid } },
      {
        $lookup: {
          from: 'users',
          let: { uid: '$user' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
            {
              $match: {
                $or: [
                  { email: { $exists: false } },
                  { email: null },
                  { email: { $not: DEMO_PRODUCT_RATER_EMAIL_RE } },
                ],
              },
            },
          ],
          as: '_u',
        },
      },
      { $unwind: { path: '$_u' } },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          meta: [{ $count: 'n' }],
          pageRows: [{ $skip: skip }, { $limit: take }],
        },
      },
    ];

    type AggOut = {
      meta?: { n: number }[];
      pageRows?: Record<string, unknown>[];
    };
    const agg = await this._productRatingModel
      .aggregate<AggOut>(pipeline)
      .exec();
    const bucket = agg[0] ?? { meta: [], pageRows: [] };
    const total = bucket.meta?.[0]?.n ?? 0;
    const raw = bucket.pageRows ?? [];

    type LeanUser = {
      _id?: unknown;
      fullName?: string;
      profileImage?: string;
    };

    const items: ProductReviewPublicRow[] = raw.map((r) => {
      const usr = r._u as LeanUser | null | undefined;
      const commentRaw =
        typeof r.comment === 'string' ? r.comment.trim() : '';
      const uid =
        usr && typeof usr === 'object' && usr._id != null
          ? String(usr._id)
          : '';
      const rate = Math.min(5, Math.max(1, Math.round(Number(r.rate) || 0)));
      const createdAt =
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt ?? new Date().toISOString());
      const updatedAt =
        r.updatedAt instanceof Date
          ? r.updatedAt.toISOString()
          : String(r.updatedAt ?? createdAt);
      return {
        id: String(r._id),
        rate,
        comment: commentRaw.length > 0 ? commentRaw : null,
        createdAt,
        updatedAt,
        product: productId,
        user: {
          id: uid,
          fullName: (usr?.fullName ?? '').trim(),
          profileImage:
            typeof usr?.profileImage === 'string' && usr.profileImage.trim()
              ? usr.profileImage.trim()
              : null,
        },
      };
    });

    const hasMore = skip + items.length < total;
    return { items, total, page, take, hasMore };
  }

  /**
   * Avis plats d’une boutique (tous les `product_ratings` des produits du store),
   * tri récents — **public**, pagination seule.
   */
  async listStoreReviewsPaginated(
    storeId: string,
    opts: { page: number; take: number },
  ): Promise<StoreReviewsPageResponse> {
    const { page, take } = opts;
    if (!Types.ObjectId.isValid(storeId)) {
      return { items: [], total: 0, page, take, hasMore: false };
    }
    const storeOid = new Types.ObjectId(storeId);
    const skip = (page - 1) * take;

    const pipeline: PipelineStage[] = [
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: '_p',
        },
      },
      { $unwind: { path: '$_p' } },
      { $match: { '_p.store': storeOid } },
      {
        $lookup: {
          from: 'users',
          let: { uid: '$user' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
            {
              $match: {
                $or: [
                  { email: { $exists: false } },
                  { email: null },
                  { email: { $not: DEMO_PRODUCT_RATER_EMAIL_RE } },
                ],
              },
            },
          ],
          as: '_u',
        },
      },
      { $unwind: { path: '$_u' } },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          meta: [{ $count: 'n' }],
          pageRows: [{ $skip: skip }, { $limit: take }],
        },
      },
    ];

    type AggOut = {
      meta?: { n: number }[];
      pageRows?: Record<string, unknown>[];
    };
    const agg = await this._productRatingModel
      .aggregate<AggOut>(pipeline)
      .exec();
    const bucket = agg[0] ?? { meta: [], pageRows: [] };
    const total = bucket.meta?.[0]?.n ?? 0;
    const raw = bucket.pageRows ?? [];

    type LeanUser = {
      _id?: unknown;
      fullName?: string;
      profileImage?: string;
    };
    type LeanProduct = { _id?: unknown; title?: string };

    const items: StoreReviewPublicRow[] = raw.map((r) => {
      const usr = r._u as LeanUser | null | undefined;
      const prod = r._p as LeanProduct | null | undefined;
      const commentRaw =
        typeof r.comment === 'string' ? r.comment.trim() : '';
      const uid =
        usr && typeof usr === 'object' && usr._id != null
          ? String(usr._id)
          : '';
      const productOid =
        prod && prod._id != null ? String(prod._id) : String(r.product ?? '');
      const rate = Math.min(5, Math.max(1, Math.round(Number(r.rate) || 0)));
      const createdAt =
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt ?? new Date().toISOString());
      const updatedAt =
        r.updatedAt instanceof Date
          ? r.updatedAt.toISOString()
          : String(r.updatedAt ?? createdAt);
      const productTitle = (prod?.title ?? '').trim() || 'Plat';
      return {
        id: String(r._id),
        rate,
        comment: commentRaw.length > 0 ? commentRaw : null,
        createdAt,
        updatedAt,
        product: productOid,
        productTitle,
        user: {
          id: uid,
          fullName: (usr?.fullName ?? '').trim(),
          profileImage:
            typeof usr?.profileImage === 'string' && usr.profileImage.trim()
              ? usr.profileImage.trim()
              : null,
        },
      };
    });

    const hasMore = skip + items.length < total;
    return { items, total, page, take, hasMore };
  }

  async listLandingProductReviews(maxRaw?: number): Promise<LandingProductReviewsResponse> {
    const max = Math.min(10, Math.max(1, Math.round(Number(maxRaw)) || 10));

    type LeanUser = { fullName?: string; email?: string };
    type LeanStore = { name?: string };
    type LeanProduct = { title?: string; store?: LeanStore | null };

    const raw = await this._productRatingModel
      .find({ rate: { $gte: 4 } })
      .populate({ path: 'user', select: 'fullName email' })
      .populate({
        path: 'product',
        select: 'title store',
        populate: { path: 'store', select: 'name' },
      })
      .sort({ createdAt: -1 })
      .limit(120)
      .lean()
      .exec();

    const reviews: LandingProductReviewItem[] = [];

    for (const r of raw) {
      if (reviews.length >= max) break;

      const comment =
        typeof r.comment === 'string' ? r.comment.trim().replace(/\s+/g, ' ') : '';
      if (comment.length < 12) continue;

      const usr = r.user as LeanUser | null;
      const email = (usr?.email ?? '').trim().toLowerCase();
      if (
        email.endsWith('@seed.local') ||
        email.includes('afrikan-demo-rating')
      ) {
        continue;
      }

      const prod = r.product as LeanProduct | null;
      if (!prod) continue;

      const rawRate = Number(r.rate);
      if (!Number.isFinite(rawRate)) continue;
      const stars = Math.min(5, Math.max(1, Math.round(rawRate)));

      const productTitle = prod.title?.trim() || 'Plat';
      const storeName = prod.store?.name?.trim() || '';
      const meta = storeName ? `${productTitle} · ${storeName}` : productTitle;

      reviews.push({
        stars,
        quote: this.truncateLandingQuote(comment, 320),
        author: this.publicAuthorFromFullName(usr?.fullName),
        meta,
      });
    }

    return { reviews };
  }

  private publicAuthorFromFullName(fullName?: string): string {
    const t = (fullName ?? '').trim();
    if (!t) return 'Client';
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0]!;
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    if (!last.length) return first;
    return `${first} ${last.charAt(0).toUpperCase()}.`;
  }

  private truncateLandingQuote(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    const cut = text.slice(0, maxLen - 1).trimEnd();
    const lastSpace = cut.lastIndexOf(' ');
    const base = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
    return `${base}…`;
  }
}
