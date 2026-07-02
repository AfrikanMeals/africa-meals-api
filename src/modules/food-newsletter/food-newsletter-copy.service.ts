import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodNewsletterCampaignType } from '@schemas/food-newsletter-candidate.schema';
import { NewsletterAutomationSettingsResponse } from '@modules/newsletter-automation-settings/newsletter-automation-settings.service';

export type FoodNewsletterCopy = {
  subject: string;
  preheader: string;
  intro: string;
  cta: string;
  heroLine: string;
  source: 'llama' | 'template';
  locale: 'fr' | 'en';
};

@Injectable()
export class FoodNewsletterCopyService {
  private readonly logger = new Logger(FoodNewsletterCopyService.name);

  constructor(private readonly config: ConfigService) {}

  async generateCopy(args: {
    settings: NewsletterAutomationSettingsResponse;
    campaignType: FoodNewsletterCampaignType;
    contentSnapshot: Record<string, unknown>;
    firstName?: string;
    locale?: 'fr' | 'en';
  }): Promise<FoodNewsletterCopy> {
    const locale = args.locale ?? 'fr';
    if (args.settings.llmCopyEnabled) {
      const llm = await this.tryLlamaCopy(args, locale);
      if (llm) return llm;
    }
    return this.templateCopy(args.campaignType, args.contentSnapshot, args.firstName, locale);
  }

  private templateCopy(
    campaignType: FoodNewsletterCampaignType,
    snapshot: Record<string, unknown>,
    firstName: string | undefined,
    locale: 'fr' | 'en',
  ): FoodNewsletterCopy {
    const stores = (snapshot.stores as Array<Record<string, unknown>>) ?? [];
    const items = (snapshot.items as Array<Record<string, unknown>>) ?? [];
    const name = firstName?.trim() || (locale === 'fr' ? 'Bonjour' : 'Hello');
    const storeName = String(stores[0]?.name ?? items[0]?.storeName ?? 'Wise Eat');
    const highlight = String(stores[0]?.highlight ?? items[0]?.title ?? '');

    if (locale === 'en') {
      return {
        subject: `${name}, news from ${storeName}`.slice(0, 55),
        preheader: `Discover ${highlight || 'new dishes'} on Wise Eat`.slice(0, 90),
        intro: `Your subscribed restaurants and picks for you — ${highlight || 'fresh meals'} await.`.slice(
          0,
          280,
        ),
        cta: 'View menu',
        heroLine: `What's cooking at ${storeName}`,
        source: 'template',
        locale: 'en',
      };
    }

    const subjects: Record<FoodNewsletterCampaignType, string> = {
      [FoodNewsletterCampaignType.WISE_EAT_WEEKLY]: `${name}, vos restos et nos idées`,
      [FoodNewsletterCampaignType.STORE_SUBSCRIBER_DIGEST]: `${name}, nouveautés chez ${storeName}`,
      [FoodNewsletterCampaignType.FOOD_RECO_DIGEST]: `${name}, sélection pour vous`,
    };

    return {
      subject: subjects[campaignType].slice(0, 55),
      preheader: `Découvrez ${highlight || 'de nouveaux plats'} sur Wise Eat`.slice(0, 90),
      intro: `Vos boutiques suivies et une sélection personnalisée — ${highlight || 'de quoi vous régaler'}.`.slice(
        0,
        280,
      ),
      cta: 'Voir le menu',
      heroLine: `Les nouveautés chez ${storeName}`,
      source: 'template',
      locale: 'fr',
    };
  }

  private async tryLlamaCopy(
    args: {
      settings: NewsletterAutomationSettingsResponse;
      contentSnapshot: Record<string, unknown>;
      firstName?: string;
    },
    locale: 'fr' | 'en',
  ): Promise<FoodNewsletterCopy | null> {
    const baseUrl =
      this.config.get<string>('FOOD_NEWSLETTER_LLM_BASE_URL')?.trim() ||
      this.config.get<string>('PUSH_RECO_LLM_BASE_URL')?.trim() ||
      'http://127.0.0.1:11434';
    const model =
      args.settings.llmModel?.trim() ||
      this.config.get<string>('FOOD_NEWSLETTER_LLM_MODEL')?.trim() ||
      'llama3.2:3b';
    const timeoutMs = Number(
      this.config.get<string>('FOOD_NEWSLETTER_LLM_TIMEOUT_MS') ?? 8000,
    );

    const prompt = JSON.stringify({
      locale,
      firstName: args.firstName ?? '',
      content: args.contentSnapshot,
    });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          prompt: `Copywriter email Wise Eat. JSON: subject, preheader, intro, cta, heroLine. Context: ${prompt}`,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const body = (await res.json()) as { response?: string };
      const parsed = JSON.parse(String(body.response ?? '{}')) as Record<
        string,
        string
      >;
      if (!parsed.subject || !parsed.intro) return null;
      return {
        subject: String(parsed.subject).slice(0, 55),
        preheader: String(parsed.preheader ?? '').slice(0, 90),
        intro: String(parsed.intro).slice(0, 280),
        cta: String(parsed.cta ?? (locale === 'fr' ? 'Voir le menu' : 'View menu')).slice(
          0,
          40,
        ),
        heroLine: String(parsed.heroLine ?? parsed.intro).slice(0, 120),
        source: 'llama',
        locale,
      };
    } catch (err) {
      this.logger.debug(
        `Llama copy skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
