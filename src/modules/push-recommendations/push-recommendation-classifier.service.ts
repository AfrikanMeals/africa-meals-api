import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { RecommendationsService } from '@modules/recommendations/recommendations.service';
import { RecommendationAutomationSettingsService } from '@modules/recommendation-automation-settings/recommendation-automation-settings.service';
import {
  PushRecommendationCandidateModel,
  PushRecommendationCandidateType,
} from '@schemas/push-recommendation-candidate.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';

const BATCH_SIZE = 50;

@Injectable()
export class PushRecommendationClassifierService {
  private readonly logger = new Logger(PushRecommendationClassifierService.name);

  constructor(
    @InjectModel(PushRecommendationCandidateModel.name)
    private readonly candidateModel: Model<PushRecommendationCandidateModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly recommendations: RecommendationsService,
    private readonly automationSettings: RecommendationAutomationSettingsService,
  ) {}

  private isInRollout(userId: string, pct: number): boolean {
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    const hash = createHash('sha256').update(userId).digest('hex');
    const bucket = parseInt(hash.slice(0, 8), 16) % 100;
    return bucket < pct;
  }

  private enabledTypes(settings: Awaited<
    ReturnType<RecommendationAutomationSettingsService['getRuntimeSettings']>
  >): PushRecommendationCandidateType[] {
    const out: PushRecommendationCandidateType[] = [];
    if (settings.reorderFavoriteEnabled) {
      out.push(PushRecommendationCandidateType.REORDER_FAVORITE);
    }
    if (settings.dailyMenuMatchEnabled) {
      out.push(PushRecommendationCandidateType.DAILY_MENU_MATCH);
    }
    if (settings.storeReturnEnabled) {
      out.push(PushRecommendationCandidateType.STORE_RETURN);
    }
    if (settings.trendingLocalEnabled) {
      out.push(PushRecommendationCandidateType.TRENDING_LOCAL);
    }
    if (settings.crossCuisineDiscoveryEnabled) {
      out.push(PushRecommendationCandidateType.CROSS_CUISINE_DISCOVERY);
    }
    if (settings.promoEligibleEnabled) {
      out.push(PushRecommendationCandidateType.PROMO_ELIGIBLE);
    }
    if (settings.nearbyOpenEnabled) {
      out.push(PushRecommendationCandidateType.NEARBY_OPEN);
    }
    return out;
  }

  async runClassifierPass(): Promise<{ usersProcessed: number; candidates: number }> {
    const settings = await this.automationSettings.getRuntimeSettings();
    if (!this.automationSettings.isGloballyEnabled(settings)) {
      return { usersProcessed: 0, candidates: 0 };
    }

    const types = this.enabledTypes(settings);
    if (types.length === 0) {
      return { usersProcessed: 0, candidates: 0 };
    }

    let usersProcessed = 0;
    let candidates = 0;
    let skip = 0;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    while (true) {
      const users = await this.userModel
        .find({
          type: UserTypeEnum.USER,
          $or: [
            { 'fcm_tokens.0': { $exists: true } },
            { 'fcmTokens.0': { $exists: true } },
          ],
        })
        .select('_id firstName email countryCode')
        .sort({ _id: 1 })
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean()
        .exec();

      if (users.length === 0) break;
      skip += users.length;

      for (const user of users) {
        const userId = String(user._id);
        if (!this.isInRollout(userId, settings.pushRecoRolloutPct)) continue;
        usersProcessed += 1;

        try {
          const feed = await this.recommendations.getFeed(
            user as unknown as UserModel,
            '12',
          );
          const product = feed.products[0];
          if (!product || !product._id) continue;

          const score = Math.min(
            100,
            Math.max(
              settings.minScore,
              Number(product.recoScore ?? product.score ?? settings.minScore),
            ),
          );
          if (score < settings.minScore) continue;

          const candidateType = types.includes(
            PushRecommendationCandidateType.REORDER_FAVORITE,
          )
            ? PushRecommendationCandidateType.REORDER_FAVORITE
            : types[0];

          const productId = String(product._id);
          const storeRaw = product.store as Record<string, unknown> | undefined;
          const storeName = String(product.storeName ?? storeRaw?.name ?? '');
          const productTitle = String(product.name ?? product.title ?? 'Plat');
          const currency = String(
            product.currency ?? storeRaw?.currency ?? 'CAD',
          );
          const price = Number(product.price ?? 0);

          await this.candidateModel.updateOne(
            {
              userId: new Types.ObjectId(userId),
              refType: 'product',
              refId: new Types.ObjectId(productId),
              candidateType,
            },
            {
              $set: {
                score,
                cuisineTags: Array.isArray(product.cuisineTags)
                  ? product.cuisineTags.map(String)
                  : [],
                reasonTags: ['feed_top'],
                contextSnapshot: {
                  productTitle,
                  storeName,
                  cuisineLabel: String(product.categoryName ?? ''),
                  price,
                  currency,
                  deepLink: `wise-eat://open/product/${productId}`,
                  storeId: String(product.storeId ?? storeRaw?._id ?? ''),
                },
                computedAt: new Date(),
                expiresAt,
              },
            },
            { upsert: true },
          );
          candidates += 1;
        } catch (err) {
          this.logger.debug(
            `classifier skip user ${userId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    return { usersProcessed, candidates };
  }
}
