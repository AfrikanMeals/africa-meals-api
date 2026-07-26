import { resolveEmailWebSiteBase } from '@modules/mailer/email-web-asset-url.util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';

export type OnboardingHeroKind = 'vendor' | 'delivery' | 'partner';
export type AdCashHeroKind = 'ad-cash';
export type OnboardingSectionImageKind =
  | 'help'
  | 'kyc-vendor'
  | 'kyc-delivery'
  | 'kyc-partner'
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

/** Illustrations statiques — africa-meals-web/public/images/… */
const CURATED_POOLS: Record<CuratedEmailImageKind, CuratedPool> = {
  vendor: {
    folder: 'email-heroes',
    files: ['vendor-onboarding-01.png', 'vendor-onboarding-02.png'],
  },
  delivery: {
    folder: 'email-heroes',
    files: ['delivery-onboarding-01.png', 'delivery-onboarding-02.png'],
  },
  // Réutilise le pool vendeur tant qu’il n’y a pas d’assets dédiés partenaire.
  partner: {
    folder: 'email-heroes',
    files: ['vendor-onboarding-01.png', 'vendor-onboarding-02.png'],
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
  'kyc-partner': {
    folder: 'onboarding-sections',
    files: ['kyc-vendor-01.png', 'kyc-vendor-02.png'],
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

@Injectable()
export class EmailAiHeroImageService {
  constructor(private readonly config: ConfigService) {}

  /** Bannière hero onboarding — site vitrine /images/email-heroes/. */
  async generateForOnboarding(
    kind: OnboardingHeroKind,
    sessionId?: string,
  ): Promise<string | null> {
    const session = sessionId?.trim() || randomUUID();
    return this.resolveCuratedImageUrl(kind, session);
  }

  /** Bannière hero crédit Ad Cash — site vitrine. */
  async generateForAdCashGrant(
    sessionId: string,
    _details?: AdCashHeroDetails,
  ): Promise<string | null> {
    const session = sessionId?.trim() || randomUUID();
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

  private pickCuratedFile(kind: CuratedEmailImageKind, session: string): string {
    const pool = CURATED_POOLS[kind]?.files ?? [];
    if (!pool.length) return '';
    const hash = createHash('sha256').update(`${kind}:${session}`).digest();
    const index = hash.readUInt32BE(0) % pool.length;
    return pool[index]!;
  }

  private resolveCuratedImageUrl(
    kind: CuratedEmailImageKind,
    session: string,
  ): string | null {
    const file = this.pickCuratedFile(kind, session);
    if (!file) return null;
    const folder = CURATED_POOLS[kind]?.folder ?? 'email-heroes';
    const base = resolveEmailWebSiteBase(this.config);
    return `${base}/images/${folder}/${file}`;
  }
}
