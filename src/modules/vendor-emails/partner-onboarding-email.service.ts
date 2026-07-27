import { EmailTemplateService } from '@modules/mailer/email-template.service';
import {
  EmailAiHeroImageService,
  type OnboardingSectionImageKind,
} from '@modules/mailer/email-ai-hero-image.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { resolveEmailBrand } from '@modules/mailer/email-brand.util';
import { resolvePortalAppBaseUrl } from '@common/portal/portal-app-base-url.util';
import { MobileAppSettingsService } from '@modules/mobile-app-settings/mobile-app-settings.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { buildPartnerProfileSubmittedEmailCopy } from './partner-profile-submitted-email.util';
import {
  buildPartnerApplicationApprovedEmailCopy,
  buildPartnerApplicationRejectedEmailCopy,
} from './partner-application-decision-email.util';
import {
  buildPartnerProfileApprovedEmailCopy,
  buildPartnerProfileRejectedEmailCopy,
} from './partner-profile-decision-email.util';
import {
  buildPartnerSubscriptionChangedEmailCopy,
  buildPartnerSubscriptionExpiredEmailCopy,
  buildPartnerSubscriptionTrialReminderEmailCopy,
} from './partner-subscription-lifecycle-email.util';
import { buildPartnerReferralCodeChangedEmailCopy } from './partner-referral-code-changed-email.util';

type OnboardingBlock = {
  title: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  ctas?: { label: string; url: string }[];
  imageUrl?: string;
  imageAlt?: string;
};

const ONBOARDING_SECTION_IMAGES: Record<
  string,
  { kind: OnboardingSectionImageKind; alt: string }
> = {
  'Complétez vos informations (KYC)': {
    kind: 'kyc-vendor',
    alt: 'Vérification KYC restaurant',
  },
  'Votre dossier KYC': {
    kind: 'kyc-delivery',
    alt: 'Dossier KYC livreur',
  },
  'Votre dossier partenaire': {
    kind: 'kyc-partner',
    alt: 'Dossier fiche partenaire',
  },
  // Sections décision fiche (admin Approuver / Refuser).
  'Prochaines étapes': {
    kind: 'kyc-partner',
    alt: 'Espace partenaire après approbation',
  },
  'Votre code de parrainage': {
    kind: 'kyc-partner',
    alt: 'Code de parrainage partenaire',
  },
  'Configurez Stripe pour encaisser vos paiements': {
    kind: 'stripe',
    alt: 'Configuration des paiements en ligne',
  },
  "Besoin d'aide ?": {
    kind: 'help',
    alt: 'Support partenaire',
  },
};

@Injectable()
export class PartnerOnboardingEmailService {
  private readonly logger = new Logger(PartnerOnboardingEmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    @Inject(MobileAppSettingsService)
    private readonly mobileAppSettings: MobileAppSettingsService,
    @Inject(EmailAiHeroImageService)
    private readonly aiHero: EmailAiHeroImageService,
  ) {}

  async notifyVendorOnboardingWelcome(args: {
    email: string;
    name: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;

    const appName = this.appName();
    const adminUrl = this.resolveAdminAppUrl();
    const stripeUrl = `${adminUrl}/finances/versements`;
    const safeName = this.emailTpl.escapeHtml(
      args.name.trim() || 'Partenaire',
    );
    const safeAppName = this.emailTpl.escapeHtml(appName);

    const blocks: OnboardingBlock[] = [
      {
        title: `Bienvenue sur ${appName}`,
        paragraphs: [
          `Bonjour <strong>${safeName}</strong>,`,
          `Merci d'avoir créé votre compte <strong>restaurant</strong> sur <strong>${safeAppName}</strong>. Vous êtes à quelques étapes de proposer vos plats à nos clients.`,
          `Connectez-vous au tableau de bord vendeur pour démarrer votre inscription et suivre l'avancement de votre dossier.`,
        ],
        cta: { label: 'Ouvrir le tableau de bord', url: adminUrl },
      },
      {
        title: 'Complétez vos informations (KYC)',
        paragraphs: [
          `Pour activer votre boutique, renseignez les informations légales de votre établissement : nom commercial, adresse, région fiscale, type d'activité et coordonnées de contact.`,
          `Ces données permettent à notre équipe de vérifier votre dossier avant la mise en ligne de votre catalogue.`,
        ],
        cta: { label: 'Continuer mon inscription', url: adminUrl },
      },
      {
        title: 'Configurez Stripe pour encaisser vos paiements',
        paragraphs: [
          `Liez votre compte <strong>Stripe Connect</strong> pour recevoir les versements de vos commandes en toute sécurité.`,
          `L'assistant Stripe vous guide pour ajouter vos coordonnées bancaires et valider votre identité si nécessaire.`,
        ],
        cta: { label: 'Configurer mon compte Stripe', url: stripeUrl },
      },
      {
        title: "Besoin d'aide ?",
        paragraphs: [
          `Notre équipe est disponible pour vous accompagner à chaque étape de l'onboarding.`,
          `Écrivez-nous à <a href="mailto:${this.emailTpl.escapeHtml(this.supportEmail())}">${this.emailTpl.escapeHtml(this.supportEmail())}</a> — nous vous répondrons rapidement.`,
        ],
      },
    ];

    await this.sendBlocks({
      to: email,
      toName: args.name.trim() || 'Partenaire',
      subject: `${appName} — Bienvenue, démarrez votre restaurant`,
      blocks,
      logTag: `vendor_onboarding_welcome email=${email}`,
      heroKind: 'vendor',
    });
  }

  async notifyDeliveryAgentOnboardingWelcome(args: {
    email: string;
    name: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;

    const appName = this.appName();
    const storeLinks = await this.resolveMobileAppStoreLinks();
    const safeName = this.emailTpl.escapeHtml(
      args.name.trim() || 'Livreur',
    );

    const downloadCtas = this.buildMobileAppDownloadCtas(storeLinks);

    const blocks: OnboardingBlock[] = [
      {
        title: "Bienvenue dans l'équipe livraison",
        paragraphs: [
          `Bonjour <strong>${safeName}</strong>,`,
          `Merci d'avoir rejoint <strong>${this.emailTpl.escapeHtml(appName)}</strong> en tant que livreur partenaire. Votre dossier KYC a bien été reçu et sera examiné par notre équipe.`,
          `Téléchargez l'application mobile pour suivre votre candidature et, une fois approuvé, recevoir vos missions de livraison.`,
        ],
        ctas: downloadCtas.length ? downloadCtas : undefined,
      },
      {
        title: 'Votre dossier KYC',
        paragraphs: [
          `Vous avez transmis vos informations de livraison : identité, véhicule, zone d'intervention et acceptation des conditions.`,
          `Notre équipe vérifie votre dossier. Vous serez notifié dès que votre compte sera approuvé ou si des informations complémentaires sont nécessaires.`,
        ],
      },
      {
        title: 'Recevoir des commandes et travailler avec les restaurants',
        paragraphs: [
          `Une fois votre compte activé, vous recevrez des propositions de livraison directement dans l'application.`,
          `Vous pourrez accepter des courses, suivre vos gains et collaborer avec les restaurants partenaires inscrits sur la plateforme.`,
        ],
      },
      {
        title: "Besoin d'aide ?",
        paragraphs: [
          `Une question sur votre candidature ou l'application ?`,
          `Contactez-nous à <a href="mailto:${this.emailTpl.escapeHtml(this.supportEmail())}">${this.emailTpl.escapeHtml(this.supportEmail())}</a> — nous sommes là pour vous aider.`,
        ],
      },
    ];

    await this.sendBlocks({
      to: email,
      toName: args.name.trim() || 'Livreur',
      subject: `${appName} — Bienvenue livreur, dossier reçu`,
      blocks,
      logTag: `delivery_onboarding_welcome email=${email}`,
      heroKind: 'delivery',
    });
  }

  /**
   * Confirmation après soumission de la fiche partenaire (POST /partner/profile/submit).
   * Fire-and-forget côté caller — ne doit pas bloquer le submit HTTP.
   */
  async notifyPartnerProfileSubmitted(args: {
    email: string;
    name: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;

    const appName = this.appName();
    const displayName = args.name.trim() || 'Partenaire';
    // Copie HTML : noms / e-mails échappés avant interpolation.
    const copy = buildPartnerProfileSubmittedEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
    });
    // Sujet MIME : texte brut (pas d’entités HTML).
    const subject = `${appName} — Fiche partenaire reçue`;

    const storeLinks = await this.resolveMobileAppStoreLinks();
    const downloadCtas = this.buildMobileAppDownloadCtas(storeLinks);

    const blocks: OnboardingBlock[] = [
      {
        title: 'Fiche partenaire reçue',
        paragraphs: [copy.greetingLine, ...copy.introParagraphs],
        ctas: downloadCtas.length ? downloadCtas : undefined,
      },
      {
        title: 'Votre dossier partenaire',
        paragraphs: copy.nextStepsParagraphs,
      },
      {
        title: "Besoin d'aide ?",
        paragraphs: copy.helpParagraphs,
      },
    ];

    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject,
      blocks,
      logTag: `partner_profile_submitted email=${email}`,
      heroKind: 'partner',
    });
  }

  /**
   * Candidature Collaborations approuvée — inclut le code referral 6 caractères.
   */
  async notifyPartnerApplicationApproved(args: {
    email: string;
    name: string;
    referralCode: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;
    const code = String(args.referralCode ?? '')
      .trim()
      .toUpperCase();
    if (!code) return;

    const appName = this.appName();
    const displayName = args.name.trim() || 'Partenaire';
    const copy = buildPartnerApplicationApprovedEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      safeReferralCode: this.emailTpl.escapeHtml(code),
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
    });
    const subject = `${appName} — Candidature partenaire acceptée`;

    const storeLinks = await this.resolveMobileAppStoreLinks();
    const downloadCtas = this.buildMobileAppDownloadCtas(storeLinks);

    const blocks: OnboardingBlock[] = [
      {
        title: 'Candidature acceptée',
        paragraphs: [copy.greetingLine, ...copy.bodyParagraphs],
        ctas: downloadCtas.length ? downloadCtas : undefined,
      },
      {
        title: 'Votre code de parrainage',
        paragraphs: copy.referralParagraphs ?? [],
      },
      {
        title: "Besoin d'aide ?",
        paragraphs: copy.helpParagraphs,
      },
    ];

    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject,
      blocks,
      logTag: `partner_application_approved email=${email}`,
      heroKind: 'partner',
    });
  }

  /** Candidature Collaborations refusée — motif admin dans le corps. */
  async notifyPartnerApplicationRejected(args: {
    email: string;
    name: string;
    rejectionReason: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;

    const appName = this.appName();
    const displayName = args.name.trim() || 'Candidat';
    const reason = args.rejectionReason.trim() || 'Non précisé';
    const copy = buildPartnerApplicationRejectedEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      safeRejectionReason: this.emailTpl.escapeHtml(reason),
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
    });
    const subject = `${appName} — Candidature partenaire refusée`;

    const blocks: OnboardingBlock[] = [
      {
        title: 'Candidature refusée',
        paragraphs: [copy.greetingLine, ...copy.bodyParagraphs],
      },
      {
        title: "Besoin d'aide ?",
        paragraphs: copy.helpParagraphs,
      },
    ];

    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject,
      blocks,
      logTag: `partner_application_rejected email=${email}`,
      heroKind: 'partner',
    });
  }

  /**
   * Fiche `partner_profiles` approuvée par l’admin — distinct de la candidature Collaborations.
   * Inclut le code de parrainage (même contrat que l’approve candidature).
   */
  async notifyPartnerProfileApproved(args: {
    email: string;
    name: string;
    referralCode: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;
    const code = String(args.referralCode ?? '')
      .trim()
      .toUpperCase();
    // Sans code : pas d’e-mail trompeur (l’appelant doit allouer avant).
    if (!code) return;

    const appName = this.appName();
    const displayName = args.name.trim() || 'Partenaire';
    const copy = buildPartnerProfileApprovedEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
      safeReferralCode: this.emailTpl.escapeHtml(code),
    });
    const subject = `${appName} — Fiche partenaire approuvée`;

    const storeLinks = await this.resolveMobileAppStoreLinks();
    const downloadCtas = this.buildMobileAppDownloadCtas(storeLinks);

    const blocks: OnboardingBlock[] = [
      {
        title: 'Fiche partenaire approuvée',
        paragraphs: [copy.greetingLine, ...copy.bodyParagraphs],
        ctas: downloadCtas.length ? downloadCtas : undefined,
      },
      {
        title: 'Votre code de parrainage',
        paragraphs: copy.referralParagraphs ?? [],
      },
      {
        title: 'Prochaines étapes',
        paragraphs: copy.nextStepsParagraphs ?? [],
      },
      {
        title: "Besoin d'aide ?",
        paragraphs: copy.helpParagraphs,
      },
    ];

    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject,
      blocks,
      logTag: `partner_profile_approved email=${email} referral=${code}`,
      heroKind: 'partner',
    });
  }

  /** Admin a défini / remplacé le code parrainage Partner. */
  async notifyPartnerReferralCodeChanged(args: {
    email: string;
    name: string;
    referralCode: string;
    previousReferralCode?: string | null;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;
    const code = String(args.referralCode ?? '')
      .trim()
      .toUpperCase();
    // Sans nouveau code : pas d’e-mail trompeur.
    if (!code) return;
    const previous = String(args.previousReferralCode ?? '')
      .trim()
      .toUpperCase();

    const appName = this.appName();
    const displayName = args.name.trim() || 'Partenaire';
    const copy = buildPartnerReferralCodeChangedEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      safeReferralCode: this.emailTpl.escapeHtml(code),
      safePreviousReferralCode: previous
        ? this.emailTpl.escapeHtml(previous)
        : undefined,
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
    });

    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject: copy.subject,
      blocks: [
        {
          title: 'Code de parrainage',
          paragraphs: [copy.greetingLine, ...copy.bodyParagraphs],
        },
        {
          title: 'Votre code',
          paragraphs: copy.referralParagraphs,
        },
        { title: "Besoin d'aide ?", paragraphs: copy.helpParagraphs },
      ],
      logTag: `partner_referral_code_changed email=${email} code=${code}`,
      heroKind: 'partner',
    });
  }

  /** Abonnement Partner — changement de formule (FREE / payant / essai démarré). */
  async notifyPartnerSubscriptionChanged(args: {
    email: string;
    name: string;
    planName: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;
    const appName = this.appName();
    const displayName = args.name.trim() || 'Partenaire';
    const planName = args.planName.trim() || 'votre formule';
    const copy = buildPartnerSubscriptionChangedEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      safePlanName: this.emailTpl.escapeHtml(planName),
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
    });
    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject: copy.subject,
      blocks: [
        {
          title: 'Abonnement Partner mis à jour',
          paragraphs: [copy.greetingLine, ...copy.bodyParagraphs],
        },
        { title: "Besoin d'aide ?", paragraphs: copy.helpParagraphs },
      ],
      logTag: `partner_subscription_changed email=${email}`,
      heroKind: 'partner',
    });
  }

  /** Abonnement Partner — expiration (essai ou période payante). */
  async notifyPartnerSubscriptionExpired(args: {
    email: string;
    name: string;
    planName: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;
    const appName = this.appName();
    const displayName = args.name.trim() || 'Partenaire';
    const planName = args.planName.trim() || 'votre formule';
    const copy = buildPartnerSubscriptionExpiredEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      safePlanName: this.emailTpl.escapeHtml(planName),
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
    });
    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject: copy.subject,
      blocks: [
        {
          title: 'Abonnement Partner expiré',
          paragraphs: [copy.greetingLine, ...copy.bodyParagraphs],
        },
        { title: "Besoin d'aide ?", paragraphs: copy.helpParagraphs },
      ],
      logTag: `partner_subscription_expired email=${email}`,
      heroKind: 'partner',
    });
  }

  /** Abonnement Partner — rappel fin d’essai (J-n). */
  async notifyPartnerSubscriptionTrialReminder(args: {
    email: string;
    name: string;
    planName: string;
    daysRemaining: number;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;
    const appName = this.appName();
    const displayName = args.name.trim() || 'Partenaire';
    const planName = args.planName.trim() || 'votre formule';
    const days = Math.max(1, Math.floor(args.daysRemaining));
    const copy = buildPartnerSubscriptionTrialReminderEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      safePlanName: this.emailTpl.escapeHtml(planName),
      daysRemaining: days,
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
    });
    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject: copy.subject,
      blocks: [
        {
          title: 'Rappel essai Partner',
          paragraphs: [copy.greetingLine, ...copy.bodyParagraphs],
        },
        { title: "Besoin d'aide ?", paragraphs: copy.helpParagraphs },
      ],
      logTag: `partner_subscription_trial_reminder email=${email} days=${days}`,
      heroKind: 'partner',
    });
  }

  /** Fiche `partner_profiles` refusée — motif admin ; re-soumission possible. */
  async notifyPartnerProfileRejected(args: {
    email: string;
    name: string;
    rejectionReason: string;
  }): Promise<void> {
    const email = args.email.trim().toLowerCase();
    if (!email) return;

    const appName = this.appName();
    const displayName = args.name.trim() || 'Partenaire';
    const reason = args.rejectionReason.trim() || 'Non précisé';
    const copy = buildPartnerProfileRejectedEmailCopy({
      appName: this.emailTpl.escapeHtml(appName),
      safeDisplayName: this.emailTpl.escapeHtml(displayName),
      safeRejectionReason: this.emailTpl.escapeHtml(reason),
      supportEmail: this.emailTpl.escapeHtml(this.supportEmail()),
    });
    const subject = `${appName} — Fiche partenaire refusée`;

    const blocks: OnboardingBlock[] = [
      {
        title: 'Fiche partenaire refusée',
        paragraphs: [copy.greetingLine, ...copy.bodyParagraphs],
      },
      {
        title: "Besoin d'aide ?",
        paragraphs: copy.helpParagraphs,
      },
    ];

    await this.sendBlocks({
      to: email,
      toName: displayName,
      subject,
      blocks,
      logTag: `partner_profile_rejected email=${email}`,
      heroKind: 'partner',
    });
  }

  private async sendBlocks(args: {
    to: string;
    toName: string;
    subject: string;
    blocks: OnboardingBlock[];
    logTag: string;
    heroKind: 'vendor' | 'delivery' | 'partner';
  }): Promise<void> {
    const sessionId = `${args.heroKind}-${args.to}-${randomUUID()}`;
    const blocks = args.blocks.map((block) => {
      const rule = ONBOARDING_SECTION_IMAGES[block.title];
      if (!rule) return block;
      const imageUrl = this.aiHero.resolveSectionImageUrl(
        rule.kind,
        `${sessionId}-${rule.kind}`,
      );
      if (!imageUrl) return block;
      return { ...block, imageUrl, imageAlt: rule.alt };
    });
    const { html, text } = this.renderBlocks(blocks);
    const heroImageUrl = await this.aiHero.generateForOnboarding(
      args.heroKind,
      sessionId,
    );
    const heroAlt =
      args.heroKind === 'vendor'
        ? `Bienvenue restaurant ${this.appName()}`
        : args.heroKind === 'delivery'
          ? `Bienvenue livreur ${this.appName()}`
          : `Fiche partenaire ${this.appName()}`;
    try {
      await this.mailer.sendSimple({
        to: args.to,
        toName: args.toName,
        subject: args.subject,
        html,
        text,
        heroImageUrl: heroImageUrl ?? undefined,
        heroImageAlt: heroAlt,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`${args.logTag}: ${msg}`);
    }
  }

  private renderBlocks(blocks: OnboardingBlock[]): {
    html: string;
    text: string;
  } {
    const htmlParts: string[] = [];
    const textParts: string[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      htmlParts.push(this.emailTpl.heading(block.title));
      textParts.push(block.title);
      if (block.imageUrl) {
        htmlParts.push(
          this.emailTpl.sectionImage(
            block.imageUrl,
            block.imageAlt ?? block.title,
          ),
        );
      }
      for (const paragraph of block.paragraphs) {
        htmlParts.push(this.emailTpl.paragraph(paragraph));
        textParts.push(this.stripHtml(paragraph));
      }
      const actions =
        block.ctas?.filter((c) => c.url && c.label) ??
        (block.cta?.url && block.cta.label ? [block.cta] : []);
      for (const action of actions) {
        htmlParts.push(this.emailTpl.button(action.label, action.url));
        textParts.push(`${action.label} : ${action.url}`);
      }
      if (i < blocks.length - 1) {
        htmlParts.push(this.emailTpl.divider());
        textParts.push('—');
      }
    }

    const brand = resolveEmailBrand(this.config);
    htmlParts.push(
      this.emailTpl.muted(
        `${brand.appName} — ${brand.supportEmail}`,
      ),
    );
    textParts.push(`${brand.appName} — ${brand.supportEmail}`);

    return {
      html: htmlParts.join('\n'),
      text: textParts.join('\n\n'),
    };
  }

  private stripHtml(value: string): string {
    return value
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private appName(): string {
    return this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
  }

  private supportEmail(): string {
    return (
      this.config.get<string>('SUPPORT_EMAIL')?.trim() ||
      resolveEmailBrand(this.config).supportEmail
    );
  }

  private resolveAdminAppUrl(): string {
    // CTA onboarding Partner → portail business (alias partner.wise-eat.com en gate, URL canonique business).
    return resolvePortalAppBaseUrl({
      getEnv: (key) => this.config.get<string>(key),
      audience: 'business',
      localhostFallback: 'http://localhost:3001',
    });
  }

  private async resolveMobileAppStoreLinks(): Promise<{
    ios?: string;
    android?: string;
  }> {
    let ios = '';
    let android = '';
    try {
      const settings = await this.mobileAppSettings.getPublicSettings();
      ios = settings.appStoreUrl?.trim() ?? '';
      android = settings.playStoreUrl?.trim() ?? '';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`mobile_app_settings_read_failed: ${msg}`);
    }

    if (!ios) {
      ios =
        this.config.get<string>('MOBILE_APP_IOS_URL')?.trim() ||
        this.config.get<string>('MOBILE_APP_DOWNLOAD_URL')?.trim() ||
        this.config.get<string>('MOBILE_APP_URL')?.trim() ||
        '';
    }
    if (!android) {
      android =
        this.config.get<string>('MOBILE_APP_ANDROID_URL')?.trim() ||
        this.config.get<string>('MOBILE_APP_DOWNLOAD_URL')?.trim() ||
        this.config.get<string>('MOBILE_APP_URL')?.trim() ||
        '';
    }

    return {
      ios: ios ? ios.replace(/\/+$/, '') : undefined,
      android: android ? android.replace(/\/+$/, '') : undefined,
    };
  }

  private buildMobileAppDownloadCtas(links: {
    ios?: string;
    android?: string;
  }): { label: string; url: string }[] {
    const ctas: { label: string; url: string }[] = [];
    if (links.ios) {
      ctas.push({ label: "Télécharger sur l'App Store", url: links.ios });
    }
    if (links.android) {
      ctas.push({
        label: 'Télécharger sur Google Play',
        url: links.android,
      });
    }
    return ctas;
  }
}
