import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import { Model, Types } from 'mongoose';

type EmailRecipient = { userId: string; email: string; name: string };

export type VendorSubscriptionEmailContext = {
  subscriptionId: string;
  storeId: string;
  storeName: string;
  ownerUserId: string;
  planName: string;
  billingPeriod?: 'MONTHLY' | 'YEARLY';
  startsAt?: Date;
  endsAt?: Date;
  pricePaid?: number;
  currency?: string;
  offerNote?: string;
  changedFields?: string[];
};

@Injectable()
export class VendorSubscriptionEmailService {
  private readonly logger = new Logger(VendorSubscriptionEmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(VendorSubscriptionModel.name)
    private readonly vendorSubModel: Model<VendorSubscriptionModel>,
  ) {}

  async notifyPlanOffer(ctx: VendorSubscriptionEmailContext): Promise<void> {
    const periodLabel = this.billingPeriodLabel(ctx.billingPeriod);
    const body = ctx.offerNote?.trim()
      ? `Wise Eat vous offre l’abonnement ${ctx.planName} pour ${ctx.storeName}.${periodLabel ? ` Facturation : ${periodLabel}.` : ''} ${ctx.offerNote.trim()}`
      : `Wise Eat vous offre l’abonnement ${ctx.planName} pour ${ctx.storeName}.${periodLabel ? ` Facturation : ${periodLabel}.` : ''} Profitez de votre accès vendeur selon les dates indiquées ci-dessous.`;

    await this.sendSubscriptionEmail({
      ctx,
      logTag: 'subscription_plan_offer',
      subject: 'Offre d’abonnement activée',
      heading: 'Offre d’abonnement',
      body,
      extraRows: ctx.offerNote?.trim()
        ? [{ label: 'Message', value: ctx.offerNote.trim() }]
        : [],
      ctaLabel: 'Voir mon abonnement',
    });
  }

  async notifyPlanRenewal(ctx: VendorSubscriptionEmailContext): Promise<void> {
    const periodLabel = this.billingPeriodLabel(ctx.billingPeriod);
    const amount =
      ctx.pricePaid != null && Number.isFinite(ctx.pricePaid)
        ? this.formatAmount(ctx.pricePaid, ctx.currency ?? 'CAD')
        : '';
    const body = amount
      ? `Votre abonnement ${ctx.planName} pour ${ctx.storeName} a été renouvelé (${amount}${periodLabel ? ` · ${periodLabel}` : ''}).`
      : `Votre abonnement ${ctx.planName} pour ${ctx.storeName} a été renouvelé${periodLabel ? ` (${periodLabel})` : ''}.`;

    await this.sendSubscriptionEmail({
      ctx,
      logTag: 'subscription_plan_renewal',
      subject: 'Abonnement renouvelé',
      heading: 'Renouvellement d’abonnement',
      body,
      extraRows: amount ? [{ label: 'Montant payé', value: amount }] : [],
      ctaLabel: 'Gérer mon abonnement',
    });
  }

  async notifyPlanExpiration(ctx: VendorSubscriptionEmailContext): Promise<void> {
    const body = `Votre abonnement ${ctx.planName} pour ${ctx.storeName} a expiré. Certaines fonctionnalités vendeur peuvent être limitées. Renouvelez votre formule pour continuer sans interruption.`;

    await this.sendSubscriptionEmail({
      ctx,
      logTag: 'subscription_plan_expiration',
      subject: 'Abonnement expiré',
      heading: 'Expiration d’abonnement',
      body,
      ctaLabel: 'Renouveler mon abonnement',
    });
  }

  async notifyPlanCatalogUpdate(args: {
    planId: string;
    planName: string;
    changedFields: string[];
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.planId)) return;
    const changed = args.changedFields.filter(Boolean);
    if (!changed.length) return;

    const subs = await this.vendorSubModel
      .find({
        plan: new Types.ObjectId(args.planId),
        status: 'ACTIVE',
        endsAt: { $gt: new Date() },
      })
      .select('_id store owner planName billingPeriod startsAt endsAt pricePaid currency')
      .lean()
      .exec();

    const changesLabel = changed.join(', ');
    for (const sub of subs) {
      const ctx = await this.buildContextFromSubscription(sub);
      if (!ctx) continue;
      const body = `La formule ${args.planName} associée à ${ctx.storeName} a été mise à jour (${changesLabel}). Consultez les détails et les nouvelles conditions dans votre espace vendeur.`;
      await this.sendSubscriptionEmail({
        ctx,
        logTag: `subscription_plan_update plan=${args.planId} sub=${ctx.subscriptionId}`,
        subject: 'Formule d’abonnement mise à jour',
        heading: 'Mise à jour de formule',
        body,
        extraRows: [{ label: 'Éléments modifiés', value: changesLabel }],
        ctaLabel: 'Voir mon abonnement',
      });
    }
  }

  async buildContextFromSubscription(
    sub: Record<string, unknown>,
  ): Promise<VendorSubscriptionEmailContext | null> {
    const subscriptionId = String(sub._id ?? '');
    const storeId = String(sub.store ?? '');
    const ownerUserId = String(sub.owner ?? '');
    if (
      !Types.ObjectId.isValid(subscriptionId) ||
      !Types.ObjectId.isValid(storeId) ||
      !Types.ObjectId.isValid(ownerUserId)
    ) {
      return null;
    }

    const store = await this.storeModel
      .findById(storeId)
      .select('name')
      .lean()
      .exec();
    const storeName = String(store?.name ?? '').trim() || 'Votre boutique';
    const billingPeriod = sub.billingPeriod as 'MONTHLY' | 'YEARLY' | undefined;

    return {
      subscriptionId,
      storeId,
      storeName,
      ownerUserId,
      planName: String(sub.planName ?? '').trim() || 'Abonnement',
      billingPeriod:
        billingPeriod === 'MONTHLY' || billingPeriod === 'YEARLY'
          ? billingPeriod
          : undefined,
      startsAt: sub.startsAt instanceof Date ? sub.startsAt : sub.startsAt ? new Date(String(sub.startsAt)) : undefined,
      endsAt: sub.endsAt instanceof Date ? sub.endsAt : sub.endsAt ? new Date(String(sub.endsAt)) : undefined,
      pricePaid:
        sub.pricePaid != null ? Number(sub.pricePaid) : undefined,
      currency: String(sub.currency ?? 'CAD').trim().toUpperCase() || 'CAD',
    };
  }

  private async sendSubscriptionEmail(args: {
    ctx: VendorSubscriptionEmailContext;
    logTag: string;
    subject: string;
    heading: string;
    body: string;
    extraRows?: Array<{ label: string; value: string }>;
    ctaLabel: string;
  }): Promise<void> {
    const recipient = await this.userRecipient(args.ctx.ownerUserId);
    if (!recipient) {
      this.logger.warn(
        `${args.logTag}: no email for owner=${args.ctx.ownerUserId}`,
      );
      return;
    }

    const rows: Array<{ label: string; value: string }> = [
      { label: 'Boutique', value: args.ctx.storeName },
      { label: 'Formule', value: args.ctx.planName },
    ];
    if (args.ctx.startsAt) {
      rows.push({
        label: 'Début',
        value: this.formatDateFr(args.ctx.startsAt),
      });
    }
    if (args.ctx.endsAt) {
      rows.push({
        label: 'Fin',
        value: this.formatDateFr(args.ctx.endsAt),
      });
    }
    const periodLabel = this.billingPeriodLabel(args.ctx.billingPeriod);
    if (periodLabel) {
      rows.push({ label: 'Période', value: periodLabel });
    }
    if (args.extraRows?.length) {
      rows.push(...args.extraRows);
    }

    const appName =
      this.config.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const settingsUrl = this.subscriptionSettingsUrl();
    const safeName = this.emailTpl.escapeHtml(recipient.name);
    const safeBody = this.emailTpl.escapeHtml(args.body);
    const html = [
      this.emailTpl.heading(args.heading),
      this.emailTpl.paragraph(`Bonjour <strong>${safeName}</strong>,`),
      this.emailTpl.paragraph(safeBody),
      this.emailTpl.infoPanel(this.emailTpl.keyValues(rows)),
      this.emailTpl.button(args.ctaLabel, settingsUrl),
      this.emailTpl.muted(
        'Pour toute question sur votre abonnement, contactez le support Wise Eat.',
      ),
    ].join('\n');
    const text = [
      `Bonjour ${recipient.name},`,
      '',
      args.body,
      '',
      ...rows.map((r) => `${r.label} : ${r.value}`),
      '',
      `${args.ctaLabel} : ${settingsUrl}`,
      '',
      `— L'équipe ${appName}`,
    ].join('\n');

    try {
      await this.mailer.sendSimple({
        to: recipient.email,
        toName: recipient.name,
        subject: `${appName} — ${args.subject}`,
        html,
        text,
        logContext: args.logTag,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`${args.logTag} email=${recipient.email}: ${msg}`);
    }
  }

  private async userRecipient(userId: string): Promise<EmailRecipient | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const user = await this.userModel
      .findById(userId)
      .select('fullName email')
      .lean()
      .exec();
    const email = String(user?.email ?? '')
      .trim()
      .toLowerCase();
    if (!email) return null;
    return {
      userId,
      email,
      name: String(user?.fullName ?? '').trim() || 'Bonjour',
    };
  }

  private subscriptionSettingsUrl(): string {
    const adminBase =
      this.config.get<string>('ADMIN_APP_URL')?.trim() ||
      this.config.get<string>('FRONTEND_URL')?.trim() ||
      'http://localhost:3001';
    return `${adminBase.replace(/\/+$/, '')}/settings/subscription`;
  }

  private billingPeriodLabel(
    period?: 'MONTHLY' | 'YEARLY',
  ): string {
    if (period === 'MONTHLY') return 'Mensuel';
    if (period === 'YEARLY') return 'Annuel';
    return '';
  }

  private formatAmount(amount: number, currency: string): string {
    const cur = (currency ?? 'CAD').trim().toUpperCase() || 'CAD';
    const n = Number(amount);
    const safe = Number.isFinite(n) ? n : 0;
    return `${safe.toFixed(2)} ${cur}`;
  }

  private formatDateFr(value: Date): string {
    if (Number.isNaN(value.getTime())) return '';
    return value.toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}
