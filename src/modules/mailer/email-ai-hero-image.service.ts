import { resolveEmailBrand } from '@modules/mailer/email-brand.util';
import { MediasService } from '@modules/medias/medias.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash, randomUUID } from 'crypto';

export type OnboardingHeroKind = 'vendor' | 'delivery';
export type AdCashHeroKind = 'ad-cash';
export type OnboardingSectionImageKind =
  | 'help'
  | 'kyc-vendor'
  | 'kyc-delivery'
  | 'stripe';
export type CuratedEmailImageKind =
  | OnboardingHeroKind
  | AdCashHeroKind
  | OnboardingSectionImageKind;

export type AdCashHeroDetails = {
  adCashAmount: number;
  currencyEquivalent: number;
  currency: string;
  storeName: string;
};

type CuratedPool = { folder: string; files: string[] };

/** Illustrations générées via Cursor — hébergées sur le site vitrine. */
const CURATED_POOLS: Record<CuratedEmailImageKind, CuratedPool> = {
  vendor: {
    folder: 'email-heroes',
    files: ['vendor-onboarding-01.png', 'vendor-onboarding-02.png'],
  },
  delivery: {
    folder: 'email-heroes',
    files: ['delivery-onboarding-01.png', 'delivery-onboarding-02.png'],
  },
  help: {
    folder: 'help',
    files: ['help-section-01.png', 'help-section-02.png'],
  },
  'kyc-vendor': {
    folder: 'onboarding-sections',
    files: ['kyc-vendor-01.png', 'kyc-vendor-02.png'],
  },
  'kyc-delivery': {
    folder: 'onboarding-sections',
    files: ['kyc-delivery-01.png', 'kyc-delivery-02.png'],
  },
  stripe: {
    folder: 'onboarding-sections',
    files: ['stripe-01.png', 'stripe-02.png'],
  },
  'ad-cash': {
    folder: 'email-heroes',
    files: ['vendor-onboarding-01.png', 'vendor-onboarding-02.png'],
  },
};

const STYLE_SUFFIX =
  'Flat modern SaaS marketing illustration, warm palette deep brown #392800 and gold #ffae00 accents, soft cream background, clean minimal composition, friendly professional mood, no text, no words, no letters, no logos, no watermark, wide 16:9 hero banner.';

const VENDOR_SCENES = [
  'Restaurant point-of-sale tablet on a warm wooden counter, colorful African cuisine icons on the touchscreen, receipt printer beside it, subtle orange glow under the counter.',
  'Welcoming African restaurant kitchen with chef presenting jollof rice, grilled fish and plantains on wooden plates, golden ambient lighting.',
];

const DELIVERY_SCENES = [
  'Food delivery courier with insulated thermal bag leaving a vibrant African restaurant, city street at golden hour, warm orange sky.',
  'Delivery driver on a scooter with meal packages, African neighborhood backdrop, dynamic friendly illustration.',
];

const AD_CASH_SCENES = [
  'Golden advertising credit coins flowing into a restaurant marketing dashboard on a tablet, megaphone and banner icons, African restaurant ambiance, celebratory warm gold #ffae00 glow.',
  'Restaurant owner smiling at digital wallet with ad campaign credits, coins and chart rising, modern SaaS marketing reward illustration, deep brown and gold palette.',
];

@Injectable()
export class EmailAiHeroImageService {
  private readonly logger = new Logger(EmailAiHeroImageService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(MediasService) private readonly medias: MediasService,
  ) {}

  /**
   * Bannière hero onboarding — une illustration différente par envoi.
   * Par défaut : pool Cursor sur https://wise-eat.com/images/email-heroes/.
   */
  async generateForOnboarding(
    kind: OnboardingHeroKind,
    sessionId?: string,
  ): Promise<string | null> {
    const session = sessionId?.trim() || randomUUID();

    if (this.geminiEnabled()) {
      const generated = await this.tryGenerateWithGemini(kind, session);
      if (generated) return generated;
    }

    return this.resolveCuratedImageUrl(kind, session);
  }

  /**
   * Bannière hero crédit Ad Cash — Gemini, puis SVG Sharp personnalisé, puis pool vitrine.
   */
  async generateForAdCashGrant(
    sessionId: string,
    details?: AdCashHeroDetails,
  ): Promise<string | null> {
    const session = sessionId?.trim() || randomUUID();

    if (this.geminiEnabled()) {
      const generated = await this.tryGenerateAdCashWithGemini(session);
      if (generated) return generated;
    }

    if (details) {
      const rendered = await this.tryGenerateAdCashHeroWithSharp(session, details);
      if (rendered) return rendered;
    }

    return this.resolveCuratedImageUrl('ad-cash', session);
  }

  /** Illustration d'une section onboarding (KYC, Stripe, aide, …). */
  resolveSectionImageUrl(
    kind: OnboardingSectionImageKind,
    sessionId?: string,
  ): string | null {
    const session = sessionId?.trim() || randomUUID();
    return this.resolveCuratedImageUrl(kind, session);
  }

  /** @deprecated Préférer resolveSectionImageUrl('help', …) */
  resolveHelpSectionUrl(sessionId?: string): string | null {
    return this.resolveSectionImageUrl('help', sessionId);
  }

  private geminiEnabled(): boolean {
    const flag =
      this.config.get<string>('EMAIL_ONBOARDING_HERO_GEMINI')?.trim() ??
      '';
    if (flag === 'false' || flag === '0') return false;
    if (flag === 'true' || flag === '1') return Boolean(this.resolveApiKey());
    return false;
  }

  private resolveWebsiteBase(): string {
    const brand = resolveEmailBrand(this.config);
    if (brand.websiteUrl) return brand.websiteUrl;
    return (
      this.config.get<string>('EMAIL_WEBSITE_URL')?.trim()?.replace(/\/+$/, '') ||
      'https://wise-eat.com'
    );
  }

  private pickCuratedFile(kind: CuratedEmailImageKind, session: string): string {
    const pool = CURATED_POOLS[kind]?.files ?? [];
    if (!pool.length) return '';
    const hash = createHash('sha256').update(`${kind}:${session}`).digest();
    const index = hash.readUInt32BE(0) % pool.length;
    return pool[index]!;
  }

  /** URL publique absolue (clients mail / site). */
  private resolveCuratedImageUrl(
    kind: CuratedEmailImageKind,
    session: string,
  ): string | null {
    const file = this.pickCuratedFile(kind, session);
    if (!file) return null;
    const folder = CURATED_POOLS[kind]?.folder ?? 'email-heroes';
    const base = this.resolveWebsiteBase();
    return `${base}/images/${folder}/${file}`;
  }

  private async tryGenerateWithGemini(
    kind: OnboardingHeroKind,
    sessionId: string,
  ): Promise<string | null> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) return null;

    const model = this.resolveModel();
    const scenes = kind === 'vendor' ? VENDOR_SCENES : DELIVERY_SCENES;
    const scene = scenes[Math.floor(Math.random() * scenes.length)];
    const prompt = `${scene} ${STYLE_SUFFIX} Session: ${sessionId}.`;

    try {
      const image = await this.requestGeminiImage(apiKey, model, prompt);
      if (!image) return null;
      return await this.medias.uploadSystemBuffer({
        buffer: image.buffer,
        contentType: image.mimeType,
        basePath: `email-heroes/onboarding/${kind}`,
        extension: image.mimeType.includes('png') ? '.png' : '.jpg',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`onboarding hero Gemini failed (${kind}): ${msg}`);
      return null;
    }
  }

  private async tryGenerateAdCashWithGemini(
    sessionId: string,
  ): Promise<string | null> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) return null;

    const model = this.resolveModel();
    const scene =
      AD_CASH_SCENES[Math.floor(Math.random() * AD_CASH_SCENES.length)];
    const prompt = `${scene} ${STYLE_SUFFIX} Session: ${sessionId}.`;

    try {
      const image = await this.requestGeminiImage(apiKey, model, prompt);
      if (!image) return null;
      return await this.medias.uploadSystemBuffer({
        buffer: image.buffer,
        contentType: image.mimeType,
        basePath: 'email-heroes/ad-cash',
        extension: image.mimeType.includes('png') ? '.png' : '.jpg',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ad-cash hero Gemini failed: ${msg}`);
      return null;
    }
  }

  private async tryGenerateAdCashHeroWithSharp(
    sessionId: string,
    details: AdCashHeroDetails,
  ): Promise<string | null> {
    try {
      const sharp = (await import('sharp')).default;
      const width = 1200;
      const height = 630;
      const storeName = this.escapeSvgText(details.storeName.trim() || 'Votre boutique');
      const acLabel = this.escapeSvgText(
        `${this.formatAdCashUnits(details.adCashAmount)} Ad Cash`,
      );
      const moneyLabel = this.escapeSvgText(
        this.formatCurrencyAmount(details.currencyEquivalent, details.currency),
      );
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fdf8f0"/>
      <stop offset="100%" stop-color="#f5e6c8"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="980" cy="120" r="90" fill="#ffae00" opacity="0.35"/>
  <circle cx="1050" cy="220" r="55" fill="#ffd966" opacity="0.25"/>
  <circle cx="180" cy="500" r="70" fill="#ffae00" opacity="0.2"/>
  <text x="80" y="110" fill="#392800" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">Wise Eat · Ad Cash</text>
  <text x="80" y="200" fill="#392800" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700">${acLabel}</text>
  <text x="80" y="270" fill="#aa6900" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="600">${moneyLabel}</text>
  <text x="80" y="340" fill="#6b5344" font-family="Arial, Helvetica, sans-serif" font-size="28">${storeName}</text>
  <text x="80" y="400" fill="#6b5344" font-family="Arial, Helvetica, sans-serif" font-size="22">Crédit publicitaire disponible pour vos campagnes</text>
  <rect x="80" y="460" width="320" height="56" rx="28" fill="#392800"/>
  <text x="240" y="496" fill="#fdf8f0" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" text-anchor="middle">Crédit reçu</text>
</svg>`;
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
      return await this.medias.uploadSystemBuffer({
        buffer,
        contentType: 'image/png',
        basePath: `email-heroes/ad-cash/${sessionId.slice(0, 8)}`,
        extension: '.png',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ad-cash hero Sharp failed: ${msg}`);
      return null;
    }
  }

  private escapeSvgText(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatAdCashUnits(amount: number): string {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('fr-CA', {
      maximumFractionDigits: 4,
    });
  }

  private formatCurrencyAmount(amount: number, currency: string): string {
    const cur = String(currency ?? 'CAD').trim().toUpperCase() || 'CAD';
    const n = Number(amount);
    const safe = Number.isFinite(n) ? n : 0;
    try {
      return new Intl.NumberFormat('fr-CA', {
        style: 'currency',
        currency: cur,
        maximumFractionDigits: 2,
      }).format(safe);
    } catch {
      return `${safe.toFixed(2)} ${cur}`;
    }
  }

  private resolveApiKey(): string {
    return (
      this.config.get<string>('GEMINI_API_KEY')?.trim() ||
      this.config.get<string>('GOOGLE_AI_API_KEY')?.trim() ||
      this.config.get<string>('GOOGLE_GENERATIVE_AI_API_KEY')?.trim() ||
      ''
    );
  }

  private resolveModel(): string {
    return (
      this.config.get<string>('GEMINI_IMAGE_MODEL')?.trim() ||
      'gemini-2.5-flash-image'
    );
  }

  private async requestGeminiImage(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await axios.post(
      url,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '16:9' },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        timeout: 90_000,
        validateStatus: () => true,
      },
    );

    if (res.status >= 400) {
      const detail =
        typeof res.data === 'object'
          ? JSON.stringify(res.data).slice(0, 400)
          : String(res.data ?? res.statusText);
      throw new Error(`Gemini HTTP ${res.status}: ${detail}`);
    }

    const parts = res.data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;

    for (const part of parts) {
      const inline = part?.inlineData ?? part?.inline_data;
      const data = inline?.data;
      const mimeType =
        inline?.mimeType ?? inline?.mime_type ?? 'image/png';
      if (typeof data === 'string' && data.length > 0) {
        return { buffer: Buffer.from(data, 'base64'), mimeType };
      }
    }

    return null;
  }
}
