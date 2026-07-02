import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { RecommendationsService } from '@modules/recommendations/recommendations.service';
import { NewsletterAutomationSettingsService } from '@modules/newsletter-automation-settings/newsletter-automation-settings.service';
import { UserNotificationPreferencesService } from '@modules/user-notification-preferences/user-notification-preferences.service';
import {
  FoodNewsletterCampaignType,
  FoodNewsletterCandidateModel,
} from '@schemas/food-newsletter-candidate.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreSubscriberModel } from '@schemas/store-subscriber.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';

const CONTENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class FoodNewsletterClassifierService {
  private readonly logger = new Logger(FoodNewsletterClassifierService.name);

  constructor(
    @InjectModel(FoodNewsletterCandidateModel.name)
    private readonly candidateModel: Model<FoodNewsletterCandidateModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(StoreSubscriberModel.name)
    private readonly subscriberModel: Model<StoreSubscriberModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    private readonly recommendations: RecommendationsService,
    private readonly automationSettings: NewsletterAutomationSettingsService,
    private readonly userPrefs: UserNotificationPreferencesService,
  ) {}

  private isInRollout(userId: string, pct: number): boolean {
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    const hash = createHash('sha256').update(userId).digest('hex');
    const bucket = parseInt(hash.slice(0, 8), 16) % 100;
    return bucket < pct;
  }

  private resolveCampaignType(
    settings: Awaited<
      ReturnType<NewsletterAutomationSettingsService['getRuntimeSettings']>
    >,
    hasStores: boolean,
    hasReco: boolean,
  ): FoodNewsletterCampaignType | null {
    if (
      settings.wiseEatWeeklyEnabled &&
      (hasStores || hasReco) &&
      (hasStores || settings.recommendedSectionEnabled)
    ) {
      return FoodNewsletterCampaignType.WISE_EAT_WEEKLY;
    }
    if (settings.storeSubscriberDigestEnabled && hasStores) {
      return FoodNewsletterCampaignType.STORE_SUBSCRIBER_DIGEST;
    }
    if (settings.foodRecoDigestEnabled && hasReco) {
      return FoodNewsletterCampaignType.FOOD_RECO_DIGEST;
    }
    return null;
  }

  async runClassifierPass(): Promise<{ usersProcessed: number; candidates: number }> {
    const settings = await this.automationSettings.getRuntimeSettings();
    if (!this.automationSettings.isGloballyEnabled(settings)) {
      return { usersProcessed: 0, candidates: 0 };
    }

    let usersProcessed = 0;
    let candidates = 0;
    let skip = 0;
    const batchSize = settings.batchSize || 25;
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const since = new Date(Date.now() - CONTENT_WINDOW_MS);

    while (true) {
      const users = await this.userModel
        .find({
          type: UserTypeEnum.USER,
          email: { $exists: true, $ne: '' },
          emailVerifiedAt: { $exists: true, $ne: null },
        })
        .select('_id fullName email appCountryCode emailVerifiedAt')
        .sort({ _id: 1 })
        .skip(skip)
        .limit(batchSize)
        .lean()
        .exec();

      if (users.length === 0) break;
      skip += users.length;

      for (const user of users) {
        const userId = String(user._id);
        if (!this.isInRollout(userId, settings.foodNewsletterRolloutPct)) continue;

        const eligible = await this.userPrefs.isEmailRecoEligible(userId);
        if (!eligible) continue;

        usersProcessed += 1;

        try {
          const storeRows = await this.subscriberModel
            .find({ user: user._id })
            .select('store')
            .lean()
            .exec();
          const storeIds = storeRows
            .map((r) => r.store)
            .filter(Boolean)
            .map(String);

          const stores: Array<Record<string, unknown>> = [];
          if (
            settings.subscribedStoresSectionEnabled &&
            storeIds.length > 0
          ) {
            const activeStores = await this.storeModel
              .find({
                _id: { $in: storeIds.map((id) => new Types.ObjectId(id)) },
                status: StoreStatusEnum.ACTIVE,
              })
              .select('_id name profileImage currency')
              .lean()
              .exec();

            for (const store of activeStores) {
              const product = await this.productModel
                .findOne({
                  store: store._id,
                  status: ProductStatusEnum.ACTIVE,
                  updatedAt: { $gte: since },
                })
                .sort({ updatedAt: -1 })
                .select('_id title price profileImage')
                .lean()
                .exec();
              if (!product) continue;
              stores.push({
                storeId: String(store._id),
                name: store.name,
                highlight: product.title,
                price: product.price,
                currency: store.currency ?? 'CAD',
                productId: String(product._id),
                imageUrl: product.profileImage ?? '',
              });
            }
          }

          const items: Array<Record<string, unknown>> = [];
          if (settings.recommendedSectionEnabled) {
            const feed = await this.recommendations.getFeed(
              user as unknown as UserModel,
              '8',
            );
            for (const product of feed.products.slice(0, 4)) {
              const score = Number(product.recoScore ?? product.score ?? 0);
              if (score < settings.minScore) continue;
              items.push({
                productId: String(product._id),
                title: String(product.name ?? product.title ?? 'Plat'),
                storeName: String(product.storeName ?? ''),
                score,
                reason: 'reco',
                price: Number(product.price ?? 0),
                currency: String(product.currency ?? 'CAD'),
              });
            }
          }

          const hasStores = stores.length >= 1;
          const hasReco = items.length >= 2;
          if (!hasStores && !hasReco) continue;

          const campaignType = this.resolveCampaignType(
            settings,
            hasStores,
            hasReco,
          );
          if (!campaignType) continue;

          const score = Math.min(
            100,
            Math.max(
              settings.minScore,
              ...items.map((i) => Number(i.score ?? settings.minScore)),
              stores.length > 0 ? settings.minScore + 5 : settings.minScore,
            ),
          );

          await this.candidateModel.updateOne(
            { userId: new Types.ObjectId(userId), campaignType },
            {
              $set: {
                score,
                contentSnapshot: { stores, items, promo: null },
                locale: user.appCountryCode === 'CA' ? 'fr-CA' : 'fr',
                region: String(user.appCountryCode ?? ''),
                computedAt: new Date(),
                expiresAt,
              },
            },
            { upsert: true },
          );
          candidates += 1;
        } catch (err) {
          this.logger.warn(
            `classifier user ${userId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    return { usersProcessed, candidates };
  }
}
