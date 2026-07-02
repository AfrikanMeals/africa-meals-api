import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PushRecommendationCandidateType,
} from '@schemas/push-recommendation-candidate.schema';
import { RecommendationAutomationSettingsResponse } from '@modules/recommendation-automation-settings/recommendation-automation-settings.service';

export type PushRecommendationCopy = {
  title: string;
  body: string;
  source: 'llama' | 'template';
  locale: 'fr' | 'en';
};

@Injectable()
export class PushRecommendationCopyService {
  private readonly logger = new Logger(PushRecommendationCopyService.name);

  constructor(private readonly config: ConfigService) {}

  async generateCopy(args: {
    settings: RecommendationAutomationSettingsResponse;
    candidateType: PushRecommendationCandidateType;
    contextSnapshot: Record<string, unknown>;
    locale?: 'fr' | 'en';
  }): Promise<PushRecommendationCopy> {
    const locale = args.locale ?? 'fr';
    if (args.settings.llmCopyEnabled) {
      const llm = await this.tryLlamaCopy(args);
      if (llm) return llm;
    }
    return this.templateCopy(args.candidateType, args.contextSnapshot, locale);
  }

  private templateCopy(
    candidateType: PushRecommendationCandidateType,
    ctx: Record<string, unknown>,
    locale: 'fr' | 'en',
  ): PushRecommendationCopy {
    const productName = String(ctx.productTitle ?? ctx.productName ?? 'Un plat');
    const storeName = String(ctx.storeName ?? 'Wise Eat');
    const templates: Record<
      PushRecommendationCandidateType,
      { fr: { title: string; body: string }; en: { title: string; body: string } }
    > = {
      [PushRecommendationCandidateType.REORDER_FAVORITE]: {
        fr: {
          title: `${productName}`.slice(0, 45),
          body: `${productName} vous attend chez ${storeName}`.slice(0, 120),
        },
        en: {
          title: `${productName}`.slice(0, 45),
          body: `${productName} is waiting at ${storeName}`.slice(0, 120),
        },
      },
      [PushRecommendationCandidateType.DAILY_MENU_MATCH]: {
        fr: {
          title: 'Au menu aujourd’hui',
          body: `${productName} — chez ${storeName}`.slice(0, 120),
        },
        en: {
          title: "On today's menu",
          body: `${productName} at ${storeName}`.slice(0, 120),
        },
      },
      [PushRecommendationCandidateType.STORE_RETURN]: {
        fr: {
          title: storeName.slice(0, 45),
          body: `De nouveautés chez ${storeName}`.slice(0, 120),
        },
        en: {
          title: storeName.slice(0, 45),
          body: `New dishes at ${storeName}`.slice(0, 120),
        },
      },
      [PushRecommendationCandidateType.TRENDING_LOCAL]: {
        fr: {
          title: 'Tendance près de vous',
          body: `${productName} — populaire en ce moment`.slice(0, 120),
        },
        en: {
          title: 'Trending near you',
          body: `${productName} — popular right now`.slice(0, 120),
        },
      },
      [PushRecommendationCandidateType.CROSS_CUISINE_DISCOVERY]: {
        fr: {
          title: 'Nouveau chez Wise Eat',
          body: `Découvrez ${productName}`.slice(0, 120),
        },
        en: {
          title: 'New on Wise Eat',
          body: `Try ${productName}`.slice(0, 120),
        },
      },
      [PushRecommendationCandidateType.PROMO_ELIGIBLE]: {
        fr: {
          title: 'Offre pour vous',
          body: `${productName} — chez ${storeName}`.slice(0, 120),
        },
        en: {
          title: 'An offer for you',
          body: `${productName} at ${storeName}`.slice(0, 120),
        },
      },
      [PushRecommendationCandidateType.NEARBY_OPEN]: {
        fr: {
          title: `${storeName}`.slice(0, 45),
          body: `Ouvert maintenant — ${productName}`.slice(0, 120),
        },
        en: {
          title: `${storeName}`.slice(0, 45),
          body: `Open now — ${productName}`.slice(0, 120),
        },
      },
    };

    const picked = templates[candidateType] ?? templates[PushRecommendationCandidateType.REORDER_FAVORITE];
    const copy = locale === 'en' ? picked.en : picked.fr;
    return { ...copy, source: 'template', locale };
  }

  private async tryLlamaCopy(args: {
    settings: RecommendationAutomationSettingsResponse;
    candidateType: PushRecommendationCandidateType;
    contextSnapshot: Record<string, unknown>;
    locale?: 'fr' | 'en';
  }): Promise<PushRecommendationCopy | null> {
    const baseUrl =
      this.config.get<string>('PUSH_RECO_LLM_BASE_URL')?.trim() ||
      this.config.get<string>('OLLAMA_BASE_URL')?.trim() ||
      'http://127.0.0.1:11434';
    const model =
      args.settings.llmModel?.trim() ||
      this.config.get<string>('PUSH_RECO_LLM_MODEL')?.trim() ||
      'llama3.2:3b';
    const timeoutMs = Number(
      this.config.get<string>('PUSH_RECO_LLM_TIMEOUT_MS') ?? 8000,
    );
    const locale = args.locale ?? 'fr';

    const prompt = JSON.stringify({
      candidateType: args.candidateType,
      locale,
      context: args.contextSnapshot,
    });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: `Tu es copywriter Wise Eat. Réponds UNIQUEMENT en JSON {"title":"...","body":"..."}. Contexte: ${prompt}`,
          stream: false,
          format: 'json',
          options: { temperature: 0.4, num_predict: 120 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const payload = (await res.json()) as { response?: string };
      const parsed = JSON.parse(String(payload.response ?? '{}')) as {
        title?: string;
        body?: string;
      };
      const title = String(parsed.title ?? '').trim().slice(0, 45);
      const body = String(parsed.body ?? '').trim().slice(0, 120);
      if (!title || !body) return null;
      return { title, body, source: 'llama', locale };
    } catch (err) {
      this.logger.debug(
        `Llama copy fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
