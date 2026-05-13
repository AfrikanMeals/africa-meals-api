import { DEMO_PRODUCT_RATER_EMAIL_RE } from '@modules/ratings/demo-product-rating-users';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';

/**
 * Comptes clients utilisés uniquement pour insérer des avis démo sur les plats
 * (même modèle que `ProductRatingModel` : user + product + rate + comment).
 */
const RATING_USER_EMAIL_RE = DEMO_PRODUCT_RATER_EMAIL_RE;

const NUM_REVIEWS_PER_STORE = 5;
const NUM_SHARED_RATING_USERS = 5;

const RATER_NAMES = [
  'Aminata Diallo',
  'Kwame Asante',
  'Fatou Camara',
  'Ibrahim Touré',
  'Nadia Bah',
];

/** Textes réalistes (tournus selon la boutique et l’index). */
const REVIEW_TEMPLATES: Array<{ rate: number; comment: string }> = [
  {
    rate: 5,
    comment:
      'Excellent plat, portions généreuses et livraison rapide. Je recommande vivement cette boutique.',
  },
  {
    rate: 4,
    comment:
      'Très bon goût, présentation soignée. Un petit détail sur la température mais dans l’ensemble très satisfait.',
  },
  {
    rate: 5,
    comment:
      'Authentique et savoureux — exactement ce que je cherchais. Merci au restaurant.',
  },
  {
    rate: 3,
    comment:
      'Correct sans être exceptionnel. Le plat était bon mais j’attendais un peu plus d’assaisonnement.',
  },
  {
    rate: 4,
    comment:
      'Bon rapport qualité-prix, emballage propre. Je commanderai à nouveau.',
  },
];

@Injectable()
export class ProductRatingsDemoSeedService implements OnModuleInit {
  private readonly logger = new Logger(ProductRatingsDemoSeedService.name);

  @InjectModel(StoreModel.name)
  private readonly storeModel: Model<StoreModel>;

  @InjectModel(ProductModel.name)
  private readonly productModel: Model<ProductModel>;

  @InjectModel(ProductRatingModel.name)
  private readonly productRatingModel: Model<ProductRatingModel>;

  @InjectModel(UserModel.name)
  private readonly userModel: Model<UserModel>;

  async onModuleInit() {
    await this.seedDemoProductRatingsIfNeeded();
  }

  /**
   * Insère jusqu’à 5 avis par boutique (un plat différent par avis, 5 clients seed partagés).
   * Idempotent : supprime d’abord les avis liés aux comptes `afrikan-demo-rating-*@seed.local`.
   *
   * Désactivé par défaut au démarrage ; activer avec `SEED_DEMO_PRODUCT_RATINGS=true` (tous environnements).
   */
  private async seedDemoProductRatingsIfNeeded() {
    if (process.env.SEED_DEMO_PRODUCT_RATINGS !== 'true') {
      return;
    }

    const stores = await this.storeModel.find().sort({ _id: 1 }).lean().exec();
    if (!stores.length) {
      this.logger.warn(
        'Avis démo plats : aucune boutique en base — aucune insertion.',
      );
      return;
    }

    await this.removePreviousSeedRatings();

    const ratingUsers = await this.ensureRatingUsers();
    if (ratingUsers.length < NUM_SHARED_RATING_USERS) {
      this.logger.warn(
        'Avis démo plats : impossible de créer les clients seed — abandon.',
      );
      return;
    }

    let totalInserted = 0;

    for (let sIdx = 0; sIdx < stores.length; sIdx++) {
      const store = stores[sIdx]!;
      const storeId = store._id;

      const products = await this.productModel
        .find({
          store: storeId,
          status: {
            $in: [
              ProductStatusEnum.ACTIVE,
              ProductStatusEnum.PENDING,
              ProductStatusEnum.INACTIVE,
            ],
          },
        })
        .sort({ _id: 1 })
        .limit(NUM_REVIEWS_PER_STORE)
        .exec();

      const n = Math.min(NUM_REVIEWS_PER_STORE, products.length);
      if (n === 0) {
        this.logger.warn(
          `Avis démo plats : boutique « ${(store as { name?: string }).name ?? storeId} » sans plat — ignorée.`,
        );
        continue;
      }
      if (n < NUM_REVIEWS_PER_STORE) {
        this.logger.warn(
          `Avis démo plats : boutique « ${(store as { name?: string }).name ?? storeId} » — seulement ${n} plat(s), ${n} avis insérés (objectif ${NUM_REVIEWS_PER_STORE}).`,
        );
      }

      for (let i = 0; i < n; i++) {
        const product = products[i]!;
        const user = ratingUsers[i]!;
        const tpl =
          REVIEW_TEMPLATES[(sIdx + i) % REVIEW_TEMPLATES.length] ??
          REVIEW_TEMPLATES[0]!;

        const rating = await this.productRatingModel.create({
          rate: tpl.rate,
          comment: tpl.comment,
          user: user._id,
          product: product._id,
        });

        await this.productModel
          .updateOne(
            { _id: product._id },
            { $push: { ratings: rating._id } },
          )
          .exec();

        totalInserted += 1;
      }
    }

    this.logger.log(
      `Avis démo plats : ${totalInserted} avis (${NUM_REVIEWS_PER_STORE} max × ${stores.length} boutique(s)), modèle product_ratings + liaison plat / client.`,
    );
  }

  private async removePreviousSeedRatings() {
    const seedUsers = await this.userModel
      .find({ email: { $regex: RATING_USER_EMAIL_RE } })
      .select('_id')
      .lean()
      .exec();

    const userIds = seedUsers.map((u) => u._id);
    if (!userIds.length) {
      return;
    }

    const groups = await this.productRatingModel
      .aggregate<{ _id: Types.ObjectId; ids: Types.ObjectId[] }>([
        { $match: { user: { $in: userIds } } },
        {
          $group: {
            _id: '$product',
            ids: { $push: '$_id' },
          },
        },
      ])
      .exec();

    for (const g of groups) {
      if (!g._id || !g.ids?.length) continue;
      await this.productModel
        .updateOne({ _id: g._id }, { $pullAll: { ratings: g.ids } })
        .exec();
    }

    const delR = await this.productRatingModel
      .deleteMany({ user: { $in: userIds } })
      .exec();
    const delU = await this.userModel
      .deleteMany({ email: { $regex: RATING_USER_EMAIL_RE } })
      .exec();

    if ((delR.deletedCount ?? 0) > 0 || (delU.deletedCount ?? 0) > 0) {
      this.logger.log(
        `Avis démo plats : nettoyage — ${delR.deletedCount ?? 0} avis, ${delU.deletedCount ?? 0} comptes seed.`,
      );
    }
  }

  private async ensureRatingUsers(): Promise<UserModel[]> {
    const out: UserModel[] = [];
    for (let i = 0; i < NUM_SHARED_RATING_USERS; i++) {
      const email = `afrikan-demo-rating-${i}@seed.local`;
      let u = await this.userModel.findOne({ email }).exec();
      if (!u) {
        u = await this.userModel.create({
          type: UserTypeEnum.USER,
          fullName: RATER_NAMES[i] ?? `Client avis démo ${i + 1}`,
          email,
          phoneNumber: `+1418555${String(4200 + i).padStart(4, '0')}`,
          password: 'AfrikanDemoRating123!',
          appCountryCode: 'CA',
        });
      }
      out.push(u);
    }
    return out;
  }
}
