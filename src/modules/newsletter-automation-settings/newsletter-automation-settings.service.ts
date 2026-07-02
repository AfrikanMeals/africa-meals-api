import {
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  NewsletterAutomationSettingsDocument,
  NewsletterAutomationSettingsModel,
} from '@schemas/newsletter-automation-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateNewsletterAutomationSettingsDto } from './dto/update-newsletter-automation-settings.dto';

const SETTINGS_KEY = 'default';
const CACHE_TTL_MS = 5_000;

export type NewsletterAutomationSettingsResponse = {
  foodNewsletterEnabled: boolean;
  foodNewsletterRolloutPct: number;
  classifierCronEnabled: boolean;
  plannerCronEnabled: boolean;
  classifierCronExpression: string;
  plannerCronExpression: string;
  llmCopyEnabled: boolean;
  llmModel: string;
  maxWeekly: number;
  maxMonthly: number;
  minGapDays: number;
  maxSameStoreDays: number;
  pauseAfterNonOpensDays: number;
  pauseAfterNonOpensCount: number;
  minScore: number;
  cuisineDiversityMaxPct: number;
  crossCuisineMaxPct: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  jitterMinutes: number;
  batchSize: number;
  wiseEatWeeklyEnabled: boolean;
  storeSubscriberDigestEnabled: boolean;
  foodRecoDigestEnabled: boolean;
  subscribedStoresSectionEnabled: boolean;
  recommendedSectionEnabled: boolean;
  promoSectionEnabled: boolean;
  reorderSectionEnabled: boolean;
  updatedAt: string | null;
};

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class NewsletterAutomationSettingsService implements OnModuleInit {
  private cache: NewsletterAutomationSettingsResponse | null = null;
  private cacheExpiresAt = 0;

  constructor(
    @InjectModel(NewsletterAutomationSettingsModel.name)
    private readonly _settings: Model<NewsletterAutomationSettingsDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.getPublicSettings();
  }

  private invalidateCache() {
    this.cache = null;
    this.cacheExpiresAt = 0;
  }

  private _toResponse(
    doc: NewsletterAutomationSettingsModel,
  ): NewsletterAutomationSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      foodNewsletterEnabled: doc.foodNewsletterEnabled === true,
      foodNewsletterRolloutPct: doc.foodNewsletterRolloutPct ?? 10,
      classifierCronEnabled: doc.classifierCronEnabled !== false,
      plannerCronEnabled: doc.plannerCronEnabled !== false,
      classifierCronExpression: doc.classifierCronExpression ?? '0 5 * * *',
      plannerCronExpression: doc.plannerCronExpression ?? '0 9 * * 2,4',
      llmCopyEnabled: doc.llmCopyEnabled === true,
      llmModel: doc.llmModel ?? 'llama3.2:3b',
      maxWeekly: doc.maxWeekly ?? 1,
      maxMonthly: doc.maxMonthly ?? 3,
      minGapDays: doc.minGapDays ?? 7,
      maxSameStoreDays: doc.maxSameStoreDays ?? 1,
      pauseAfterNonOpensDays: doc.pauseAfterNonOpensDays ?? 21,
      pauseAfterNonOpensCount: doc.pauseAfterNonOpensCount ?? 2,
      minScore: doc.minScore ?? 58,
      cuisineDiversityMaxPct: doc.cuisineDiversityMaxPct ?? 70,
      crossCuisineMaxPct: doc.crossCuisineMaxPct ?? 30,
      sendWindowStart: doc.sendWindowStart ?? '10:00',
      sendWindowEnd: doc.sendWindowEnd ?? '11:30',
      jitterMinutes: doc.jitterMinutes ?? 45,
      batchSize: doc.batchSize ?? 25,
      wiseEatWeeklyEnabled: doc.wiseEatWeeklyEnabled !== false,
      storeSubscriberDigestEnabled: doc.storeSubscriberDigestEnabled !== false,
      foodRecoDigestEnabled: doc.foodRecoDigestEnabled === true,
      subscribedStoresSectionEnabled:
        doc.subscribedStoresSectionEnabled !== false,
      recommendedSectionEnabled: doc.recommendedSectionEnabled !== false,
      promoSectionEnabled: doc.promoSectionEnabled === true,
      reorderSectionEnabled: doc.reorderSectionEnabled !== false,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getRuntimeSettings(): Promise<NewsletterAutomationSettingsResponse> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiresAt) {
      return this.cache;
    }
    const settings = await this.getPublicSettings();
    this.cache = settings;
    this.cacheExpiresAt = now + CACHE_TTL_MS;
    return settings;
  }

  isGloballyEnabled(settings: NewsletterAutomationSettingsResponse): boolean {
    if (process.env.DISABLE_FOOD_NEWSLETTER === 'true') return false;
    if (process.env.FOOD_NEWSLETTER_ENABLED === 'false') return false;
    return settings.foodNewsletterEnabled === true;
  }

  async getPublicSettings(): Promise<NewsletterAutomationSettingsResponse> {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $setOnInsert: { key: SETTINGS_KEY } },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as NewsletterAutomationSettingsModel);
  }

  async updateSettings(
    user: UserModel,
    dto: UpdateNewsletterAutomationSettingsDto,
  ): Promise<NewsletterAutomationSettingsResponse> {
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
