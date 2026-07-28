import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GainEstimateAiBlock, GainEstimatePayload } from './gain-estimate.types';
import { buildGainEstimateHeuristicAi } from './gain-estimate-heuristic.util';

/** Parse défensif de la réponse LLM JSON. */
export function parseGainEstimateLlmJson(
  raw: string,
  locale: 'fr' | 'en',
): GainEstimateAiBlock | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned) as {
      summary?: unknown;
      suggestions?: unknown;
    };
    const summary = String(parsed.summary ?? '').trim();
    if (!summary) return null;
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .map((s) => String(s ?? '').trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    if (suggestions.length === 0) {
      suggestions.push(
        locale === 'en'
          ? 'Review platform fee take rate vs Stripe costs.'
          : 'Revoir le take rate des frais plateforme vs coûts Stripe.',
      );
    }
    return { source: 'llm', summary: summary.slice(0, 800), suggestions };
  } catch {
    return null;
  }
}

@Injectable()
export class GainEstimateLlmService {
  private readonly logger = new Logger(GainEstimateLlmService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Tente Groq / Ollama (OpenAI-compatible) puis heuristique.
   * Jamais d’échec hard — toujours un bloc ai.
   */
  async analyze(
    payload: Omit<GainEstimatePayload, 'ai'>,
    locale: 'fr' | 'en',
  ): Promise<GainEstimateAiBlock> {
    const llm = await this.tryLlm(payload, locale);
    if (llm) return llm;
    return buildGainEstimateHeuristicAi(payload, locale);
  }

  private async tryLlm(
    payload: Omit<GainEstimatePayload, 'ai'>,
    locale: 'fr' | 'en',
  ): Promise<GainEstimateAiBlock | null> {
    const baseUrl = (
      this.config.get<string>('GAIN_ESTIMATE_LLM_BASE_URL')?.trim() || ''
    ).replace(/\/$/, '');
    if (!baseUrl) return null;

    const model =
      this.config.get<string>('GAIN_ESTIMATE_LLM_MODEL')?.trim() ||
      'llama-3.1-8b-instant';
    const apiKey =
      this.config.get<string>('GAIN_ESTIMATE_LLM_API_KEY')?.trim() || '';
    const timeoutMs = Number(
      this.config.get<string>('GAIN_ESTIMATE_LLM_TIMEOUT_MS') ?? 8000,
    );

    // Snapshot numérique uniquement — pas de PII.
    const context = {
      locale,
      currency: payload.currency,
      period: payload.period,
      totals: payload.totals,
      breakdown: payload.breakdown.map((r) => ({
        key: r.key,
        side: r.side,
        amountCad: r.amountCad,
        estimated: Boolean(r.estimated),
      })),
      planSnapshot: payload.planSnapshot,
      feeConfigSnapshot: payload.feeConfigSnapshot,
    };

    const system =
      locale === 'en'
        ? 'You are a fintech CFO assistant for Wise Eat marketplace. Reply ONLY with JSON: {"summary":string,"suggestions":string[]}. Max 5 suggestions. No PII. Be concrete about fees, plans, ads, SMS.'
        : 'Tu es un assistant CFO pour la marketplace Wise Eat. Réponds UNIQUEMENT en JSON: {"summary":string,"suggestions":string[]}. Max 5 suggestions. Pas de PII. Sois concret sur frais, formules, pubs, SMS.';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 1. OpenAI-compatible (Groq, Ollama /v1)
      const chatUrl = `${baseUrl}/chat/completions`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `Analyze platform P&L and suggest actions. Data: ${JSON.stringify(context)}`,
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.debug(`GainEstimate LLM HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = String(body.choices?.[0]?.message?.content ?? '');
      return parseGainEstimateLlmJson(content, locale);
    } catch (err) {
      this.logger.debug(
        `GainEstimate LLM skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
