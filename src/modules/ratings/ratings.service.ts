import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductModel } from '@schemas/product.schema';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import { StoreModel } from '@schemas/store.schema';
import { StoreRatingModel } from '@schemas/store_rating.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { CreateRatingDto } from './dto/ratings.dto';
import type {
  LandingProductReviewItem,
  LandingProductReviewsResponse,
} from './dto/landing-product-review.dto';

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
