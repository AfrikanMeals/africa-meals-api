import { EmailTemplateService } from '@modules/mailer/email-template.service';
import {
  EmailAiHeroImageService,
  type OnboardingSectionImageKind,
} from '@modules/mailer/email-ai-hero-image.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { resolveEmailBrand } from '@modules/mailer/email-brand.util';
import { MobileAppSettingsService } from '@modules/mobile-app-settings/mobile-app-settings.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

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

  private async sendBlocks(args: {
    to: string;
    toName: string;
    subject: string;
    blocks: OnboardingBlock[];
    logTag: string;
    heroKind: 'vendor' | 'delivery';
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
        : `Bienvenue livreur ${this.appName()}`;
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
    const raw =
      this.config.get<string>('ADMIN_APP_URL')?.trim() ||
      this.config.get<string>('DASHBOARD_BASE_URL')?.trim() ||
      this.config.get<string>('FRONTEND_URL')?.trim() ||
      'http://localhost:3001';
    return raw.replace(/\/+$/, '');
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
