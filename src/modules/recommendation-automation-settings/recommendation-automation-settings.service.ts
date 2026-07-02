import {
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  RecommendationAutomationSettingsDocument,
  RecommendationAutomationSettingsModel,
} from '@schemas/recommendation-automation-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateRecommendationAutomationSettingsDto } from './dto/update-recommendation-automation-settings.dto';

const SETTINGS_KEY = 'default';
const CACHE_TTL_MS = 5_000;

export type RecommendationAutomationSettingsResponse = {
  pushRecoEnabled: boolean;
  pushRecoRolloutPct: number;
  classifierCronEnabled: boolean;
  plannerCronEnabled: boolean;
  classifierCronExpression: string;
  plannerCronExpression: string;
  llmCopyEnabled: boolean;
  llmModel: string;
  maxDaily: number;
  maxWeekly: number;
  minGapHours: number;
  quietStart: string;
  quietEnd: string;
  minScore: number;
  cuisineDiversityMaxPct: number;
  reorderFavoriteEnabled: boolean;
  dailyMenuMatchEnabled: boolean;
  storeReturnEnabled: boolean;
  trendingLocalEnabled: boolean;
  crossCuisineDiscoveryEnabled: boolean;
  promoEligibleEnabled: boolean;
  nearbyOpenEnabled: boolean;
  weightCuisineAffinity: number;
  weightProductAffinity: number;
  weightUrgency: number;
  weightNovelty: number;
  weightPromoMargin: number;
  weightPushFatigue: number;
  weightNotificationRecency: number;
  weightCuisineOverrepresentation: number;
  updatedAt: string | null;
};

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class RecommendationAutomationSettingsService implements OnModuleInit {
  private cache: RecommendationAutomationSettingsResponse | null = null;
  private cacheExpiresAt = 0;

  constructor(
    @InjectModel(RecommendationAutomationSettingsModel.name)
    private readonly _settings: Model<RecommendationAutomationSettingsDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.getPublicSettings();
  }

  private invalidateCache() {
    this.cache = null;
    this.cacheExpiresAt = 0;
  }

  private _toResponse(
    doc: RecommendationAutomationSettingsModel,
  ): RecommendationAutomationSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      pushRecoEnabled: doc.pushRecoEnabled === true,
      pushRecoRolloutPct: doc.pushRecoRolloutPct ?? 10,
      classifierCronEnabled: doc.classifierCronEnabled !== false,
      plannerCronEnabled: doc.plannerCronEnabled !== false,
      classifierCronExpression: doc.classifierCronExpression ?? '0 4 * * *',
      plannerCronExpression: doc.plannerCronExpression ?? '*/20 * * * *',
      llmCopyEnabled: doc.llmCopyEnabled === true,
      llmModel: doc.llmModel ?? 'llama3.2:3b',
      maxDaily: doc.maxDaily ?? 1,
      maxWeekly: doc.maxWeekly ?? 3,
      minGapHours: doc.minGapHours ?? 4,
      quietStart: doc.quietStart ?? '22:00',
      quietEnd: doc.quietEnd ?? '08:30',
      minScore: doc.minScore ?? 62,
      cuisineDiversityMaxPct: doc.cuisineDiversityMaxPct ?? 70,
      reorderFavoriteEnabled: doc.reorderFavoriteEnabled !== false,
      dailyMenuMatchEnabled: doc.dailyMenuMatchEnabled !== false,
      storeReturnEnabled: doc.storeReturnEnabled === true,
      trendingLocalEnabled: doc.trendingLocalEnabled === true,
      crossCuisineDiscoveryEnabled: doc.crossCuisineDiscoveryEnabled === true,
      promoEligibleEnabled: doc.promoEligibleEnabled === true,
      nearbyOpenEnabled: doc.nearbyOpenEnabled === true,
      weightCuisineAffinity: doc.weightCuisineAffinity ?? 25,
      weightProductAffinity: doc.weightProductAffinity ?? 25,
      weightUrgency: doc.weightUrgency ?? 15,
      weightNovelty: doc.weightNovelty ?? 10,
      weightPromoMargin: doc.weightPromoMargin ?? 10,
      weightPushFatigue: doc.weightPushFatigue ?? 20,
      weightNotificationRecency: doc.weightNotificationRecency ?? 15,
      weightCuisineOverrepresentation:
        doc.weightCuisineOverrepresentation ?? 15,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getRuntimeSettings(): Promise<RecommendationAutomationSettingsResponse> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiresAt) {
      return this.cache;
    }
    const settings = await this.getPublicSettings();
    this.cache = settings;
    this.cacheExpiresAt = now + CACHE_TTL_MS;
    return settings;
  }

  isGloballyEnabled(settings: RecommendationAutomationSettingsResponse): boolean {
    if (process.env.DISABLE_PUSH_RECO === 'true') return false;
    return settings.pushRecoEnabled === true;
  }

  async getPublicSettings(): Promise<RecommendationAutomationSettingsResponse> {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $setOnInsert: { key: SETTINGS_KEY } },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as RecommendationAutomationSettingsModel);
  }

  async updateSettings(
    user: UserModel,
    dto: UpdateRecommendationAutomationSettingsDto,
  ): Promise<RecommendationAutomationSettingsResponse> {
    assertAdmin(user);
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: dto },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.invalidateCache();
    return this._toResponse(updated);
  }
}
