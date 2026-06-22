import {
  EmailAiHeroImageService,
} from '@modules/mailer/email-ai-hero-image.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';

@Injectable()
export class AdCashEmailService {
  private readonly logger = new Logger(AdCashEmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    @Inject(EmailAiHeroImageService)
    private readonly aiHero: EmailAiHeroImageService,
    private readonly storeAccess: StoreAccessService,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
  ) {}

  async notifyAdCashGranted(args: {
    storeId: string;
    storeName: string;
    adCashAmount: number;
    currencyEquivalent: number;
    currency: string;
    exchangeRate: number;
    balanceAdCash: number;
    note?: string | null;
    grantedByName?: string | null;
  }): Promise<void> {
    const storeId = args.storeId?.trim();
    if (!storeId || !Types.ObjectId.isValid(storeId)) return;

    const storeName = args.storeName.trim() || 'Votre boutique';
    const appName =
      this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const sessionId = `ad-cash-${storeId}-${randomUUID()}`;
    const heroImageUrl = await this.aiHero.generateForAdCashGrant(sessionId, {
      adCashAmount: args.adCashAmount,
      currencyEquivalent: args.currencyEquivalent,
      currency: args.currency,
      storeName,
    });

    const body = `Vous avez reçu du crédit Ad Cash pour la boutique « ${storeName} ». Utilisez-le pour régler vos dettes crédit Ads (bannières et campagnes archivées) depuis votre tableau de bord.`;
    const infoRows: Array<{ label: string; value: string }> = [
      { label: 'Boutique', value: storeName },
      {
        label: 'Ad Cash reçu',
        value: `${this.formatAdCashUnits(args.adCashAmount)} AC`,
      },
      {
        label: 'Équivalent',
        value: this.formatCurrencyAmount(
          args.currencyEquivalent,
          args.currency,
        ),
      },
      {
        label: 'Taux',
        value: `1 AC = ${this.formatCurrencyAmount(args.exchangeRate, args.currency)}`,
      },
      {
        label: 'Solde Ad Cash',
        value: `${this.formatAdCashUnits(args.balanceAdCash)} AC`,
      },
    ];
    if (args.grantedByName?.trim()) {
      infoRows.push({ label: 'Accordé par', value: args.grantedByName.trim() });
    }
    if (args.note?.trim()) {
      infoRows.push({ label: 'Note', value: args.note.trim() });
    }

    const dashboardUrl = this.adCreditDashboardUrl();
    const userIds =
      await this.storeAccess.listStorePushRecipientUserIds(storeId);
    const seen = new Set<string>();

    for (const userId of userIds) {
      if (!Types.ObjectId.isValid(userId)) continue;
      const user = await this.userModel
        .findById(userId)
        .select('fullName email')
        .lean()
        .exec();
      const email = String(user?.email ?? '')
        .trim()
        .toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);

      const name = String(user?.fullName ?? '').trim() || 'Bonjour';
      const safeName = this.emailTpl.escapeHtml(name);
      const safeBody = this.emailTpl.escapeHtml(body);
      const htmlParts = [
        this.emailTpl.heading('Crédit Ad Cash reçu'),
        this.emailTpl.paragraph(`Bonjour <strong>${safeName}</strong>,`),
        this.emailTpl.paragraph(safeBody),
        this.emailTpl.infoPanel(this.emailTpl.keyValues(infoRows)),
        this.emailTpl.button('Voir mon crédit Ads', dashboardUrl),
        this.emailTpl.muted(
          'L’Ad Cash est convertible selon le taux régional de votre boutique et peut être utilisé pour solder vos dettes publicitaires.',
        ),
      ];
      const html = htmlParts.join('\n');
      const text = [
        `Bonjour ${name},`,
        '',
        body,
        '',
        ...infoRows.map((r) => `${r.label} : ${r.value}`),
        '',
        `Voir mon crédit Ads : ${dashboardUrl}`,
        '',
        `— L'équipe ${appName}`,
      ].join('\n');

      try {
        await this.mailer.sendSimple({
          to: email,
          toName: name,
          subject: `${appName} — Crédit Ad Cash reçu (${storeName})`,
          html,
          text,
          heroImageUrl: heroImageUrl ?? undefined,
          heroImageAlt: `Crédit Ad Cash — ${storeName}`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `ad_cash_grant_email store=${storeId} email=${email}: ${msg}`,
        );
      }
    }
  }

  private adCreditDashboardUrl(): string {
    const adminBase =
      this.config.get<string>('ADMIN_APP_URL')?.trim() ||
      this.config.get<string>('FRONTEND_URL')?.trim() ||
      'http://localhost:3001';
    return `${adminBase.replace(/\/+$/, '')}/marketing/ad-campaigns`;
  }

  private formatAdCashUnits(amount: number): string {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('fr-CA', { maximumFractionDigits: 4 });
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
}
