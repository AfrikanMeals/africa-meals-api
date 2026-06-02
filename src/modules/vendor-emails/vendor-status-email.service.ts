import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

export type AdMarketingEntityStatus =
  | 'active'
  | 'paused'
  | 'scheduled'
  | 'expired'
  | 'ended';

type EmailRecipient = { userId: string; email: string; name: string };

@Injectable()
export class VendorStatusEmailService {
  private readonly logger = new Logger(VendorStatusEmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly emailTpl: EmailTemplateService,
    private readonly storeAccess: StoreAccessService,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
  ) {}

  static resolveCampaignStatus(doc: {
    isActive?: boolean;
    startsAt?: Date | string | null;
    endsAt?: Date | string | null;
    archivedAt?: Date | string | null;
    archiveReason?: string | null;
  }): AdMarketingEntityStatus {
    if (doc.archivedAt != null && String(doc.archivedAt).trim() !== '') {
      return doc.archiveReason === 'EXPIRED' ? 'expired' : 'ended';
    }
    const now = Date.now();
    const endsAt = doc.endsAt ? new Date(doc.endsAt).getTime() : NaN;
    if (Number.isFinite(endsAt) && now > endsAt) return 'expired';
    if (!doc.isActive) return 'paused';
    const startsAt = doc.startsAt ? new Date(doc.startsAt).getTime() : NaN;
    if (Number.isFinite(startsAt) && now < startsAt) return 'scheduled';
    return 'active';
  }

  static resolveBannerStatus(doc: {
    isActive?: boolean;
    validFrom?: Date | string | null;
    validUntil?: Date | string | null;
    archivedAt?: Date | string | null;
    archiveReason?: string | null;
  }): AdMarketingEntityStatus {
    if (doc.archivedAt != null && String(doc.archivedAt).trim() !== '') {
      return doc.archiveReason === 'EXPIRED' ? 'expired' : 'ended';
    }
    const now = Date.now();
    const validUntil = doc.validUntil ? new Date(doc.validUntil).getTime() : NaN;
    if (Number.isFinite(validUntil) && now > validUntil) return 'expired';
    if (!doc.isActive) return 'paused';
    const validFrom = doc.validFrom ? new Date(doc.validFrom).getTime() : NaN;
    if (Number.isFinite(validFrom) && now < validFrom) return 'scheduled';
    return 'active';
  }

  static marketingStatusLabelFr(status: AdMarketingEntityStatus): string {
    switch (status) {
      case 'active':
        return 'Active';
      case 'paused':
        return 'En pause';
      case 'scheduled':
        return 'Planifiée';
      case 'expired':
        return 'Expirée';
      case 'ended':
        return 'Terminée';
      default:
        return status;
    }
  }

  async notifyAdCampaignStatusChange(args: {
    storeId: string;
    campaignId: string;
    campaignTitle: string;
    previousStatus: AdMarketingEntityStatus;
    newStatus: AdMarketingEntityStatus;
  }): Promise<void> {
    if (args.previousStatus === args.newStatus) return;
    const storeName = await this.storeName(args.storeId);
    const prev = VendorStatusEmailService.marketingStatusLabelFr(
      args.previousStatus,
    );
    const next = VendorStatusEmailService.marketingStatusLabelFr(args.newStatus);
    const body = `Le statut de votre campagne publicitaire « ${args.campaignTitle.trim() || 'Sans titre'} » (${storeName}) est passé de « ${prev} » à « ${next} ».`;
    await this.sendToStoreRecipients({
      storeId: args.storeId,
      subject: 'Statut de campagne publicitaire mis à jour',
      heading: 'Campagne publicitaire',
      body,
      infoRows: [
        { label: 'Campagne', value: args.campaignTitle.trim() || 'Sans titre' },
        { label: 'Restaurant', value: storeName },
        { label: 'Nouveau statut', value: next },
      ],
      logTag: `ad_campaign_status store=${args.storeId} campaign=${args.campaignId}`,
    });
  }

  async notifyBannerStatusChange(args: {
    storeId: string;
    bannerId: string;
    bannerTitle: string;
    previousStatus: AdMarketingEntityStatus;
    newStatus: AdMarketingEntityStatus;
  }): Promise<void> {
    if (args.previousStatus === args.newStatus) return;
    const storeName = await this.storeName(args.storeId);
    const prev = VendorStatusEmailService.marketingStatusLabelFr(
      args.previousStatus,
    );
    const next = VendorStatusEmailService.marketingStatusLabelFr(args.newStatus);
    const body = `Le statut de votre bannière « ${args.bannerTitle.trim() || 'Sans titre'} » (${storeName}) est passé de « ${prev} » à « ${next} ».`;
    await this.sendToStoreRecipients({
      storeId: args.storeId,
      subject: 'Statut de bannière mis à jour',
      heading: 'Bannière publicitaire',
      body,
      infoRows: [
        { label: 'Bannière', value: args.bannerTitle.trim() || 'Sans titre' },
        { label: 'Restaurant', value: storeName },
        { label: 'Nouveau statut', value: next },
      ],
      logTag: `ad_banner_status store=${args.storeId} banner=${args.bannerId}`,
    });
  }

  async notifyPayoutStatusChange(args: {
    userId: string;
    payoutId: string;
    amount: number;
    currency: string;
    status: string;
    arrivalDate?: string | null;
  }): Promise<void> {
    const status = (args.status ?? '').trim().toLowerCase();
    if (!status) return;
    const recipient = await this.userRecipient(args.userId);
    if (!recipient) return;

    const amountStr = this.formatAmount(args.amount, args.currency);
    const { title, body } = this.payoutCopy(status, amountStr, args.arrivalDate);
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Montant', value: amountStr },
      { label: 'Statut', value: this.payoutStatusLabelFr(status) },
      { label: 'Référence', value: args.payoutId },
    ];
    if (args.arrivalDate?.trim()) {
      rows.push({
        label: 'Arrivée estimée',
        value: this.formatDateFr(args.arrivalDate),
      });
    }

    await this.sendToRecipient({
      recipient,
      subject: title,
      heading: 'Versement',
      body,
      infoRows: rows,
      logTag: `payout_status user=${args.userId} payout=${args.payoutId} status=${status}`,
    });
  }

  async notifyVendorRefundStatusChange(args: {
    storeId: string;
    orderId: string;
    storeName: string;
    kind: 'processing' | 'completed' | 'rejected' | 'paused' | 'resumed';
    amount: number;
    currency: string;
    note?: string;
  }): Promise<void> {
    const orderRef = `#AE-${args.orderId.slice(-6).toUpperCase()}`;
    const amountStr = this.formatAmount(args.amount, args.currency);
    const { title, body } = this.vendorRefundCopy(
      args.kind,
      args.storeName,
      orderRef,
      amountStr,
    );
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Commande', value: orderRef },
      { label: 'Restaurant', value: args.storeName },
      { label: 'Montant', value: amountStr },
    ];
    if (args.note?.trim()) {
      rows.push({ label: 'Note', value: args.note.trim() });
    }

    await this.sendToStoreRecipients({
      storeId: args.storeId,
      subject: title,
      heading: 'Remboursement client',
      body,
      infoRows: rows,
      logTag: `vendor_refund_status store=${args.storeId} order=${args.orderId} kind=${args.kind}`,
    });
  }

  private payoutCopy(
    status: string,
    amountStr: string,
    arrivalDate?: string | null,
  ): { title: string; body: string } {
    switch (status) {
      case 'pending':
        return {
          title: 'Versement en cours de traitement',
          body: `Votre demande de versement de ${amountStr} a été enregistrée et est en cours de traitement.`,
        };
      case 'in_transit':
        return {
          title: 'Versement en transit',
          body: `Votre versement de ${amountStr} est en transit vers votre compte bancaire${
            arrivalDate?.trim()
              ? ` (arrivée estimée : ${this.formatDateFr(arrivalDate)})`
              : ''
          }.`,
        };
      case 'paid':
        return {
          title: 'Versement effectué',
          body: `Votre versement de ${amountStr} a été effectué avec succès.`,
        };
      case 'failed':
        return {
          title: 'Versement échoué',
          body: `Votre versement de ${amountStr} n'a pas pu être effectué. Vérifiez vos coordonnées bancaires ou contactez le support.`,
        };
      case 'canceled':
      case 'cancelled':
        return {
          title: 'Versement annulé',
          body: `Votre versement de ${amountStr} a été annulé.`,
        };
      default:
        return {
          title: 'Mise à jour de versement',
          body: `Le statut de votre versement de ${amountStr} a été mis à jour (${this.payoutStatusLabelFr(status)}).`,
        };
    }
  }

  private vendorRefundCopy(
    kind: 'processing' | 'completed' | 'rejected' | 'paused' | 'resumed',
    storeName: string,
    orderRef: string,
    amountStr: string,
  ): { title: string; body: string } {
    switch (kind) {
      case 'processing':
        return {
          title: 'Remboursement client en cours',
          body: `${storeName} : un remboursement client (${amountStr}) est en cours de traitement pour la commande ${orderRef}.`,
        };
      case 'completed':
        return {
          title: 'Remboursement client effectué',
          body: `${storeName} : le remboursement client (${amountStr}) a été effectué pour la commande ${orderRef}.`,
        };
      case 'rejected':
        return {
          title: 'Demande de remboursement refusée',
          body: `${storeName} : la demande de remboursement pour la commande ${orderRef} a été refusée.`,
        };
      case 'paused':
        return {
          title: 'Remboursement client en pause',
          body: `${storeName} : le traitement du remboursement pour la commande ${orderRef} est temporairement en pause.`,
        };
      case 'resumed':
        return {
          title: 'Remboursement client repris',
          body: `${storeName} : le traitement du remboursement pour la commande ${orderRef} reprend.`,
        };
    }
  }

  private payoutStatusLabelFr(status: string): string {
    switch (status) {
      case 'pending':
        return 'En attente';
      case 'in_transit':
        return 'En transit';
      case 'paid':
        return 'Effectué';
      case 'failed':
        return 'Échoué';
      case 'canceled':
      case 'cancelled':
        return 'Annulé';
      default:
        return status;
    }
  }

  private async storeName(storeId: string): Promise<string> {
    if (!Types.ObjectId.isValid(storeId)) return 'Restaurant';
    const store = await this.storeModel
      .findById(storeId)
      .select('name')
      .lean()
      .exec();
    return String(store?.name ?? '').trim() || 'Restaurant';
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

  private async storeRecipients(storeId: string): Promise<EmailRecipient[]> {
    const userIds = await this.storeAccess.listStorePushRecipientUserIds(
      storeId,
    );
    const seen = new Set<string>();
    const out: EmailRecipient[] = [];
    for (const userId of userIds) {
      const row = await this.userRecipient(userId);
      if (!row || seen.has(row.email)) continue;
      seen.add(row.email);
      out.push(row);
    }
    return out;
  }

  private async sendToStoreRecipients(args: {
    storeId: string;
    subject: string;
    heading: string;
    body: string;
    infoRows: Array<{ label: string; value: string }>;
    logTag: string;
  }): Promise<void> {
    const recipients = await this.storeRecipients(args.storeId);
    if (!recipients.length) {
      this.logger.warn(`${args.logTag}: aucun destinataire e-mail`);
      return;
    }
    await Promise.all(
      recipients.map((recipient) =>
        this.sendToRecipient({ ...args, recipient }),
      ),
    );
  }

  private async sendToRecipient(args: {
    recipient: EmailRecipient;
    subject: string;
    heading: string;
    body: string;
    infoRows: Array<{ label: string; value: string }>;
    logTag: string;
  }): Promise<void> {
    const appName =
      this.config.get<string>('APP_NAME')?.trim() || 'Afrika Meals';
    const safeName = this.emailTpl.escapeHtml(args.recipient.name);
    const safeBody = this.emailTpl.escapeHtml(args.body);
    const html = [
      this.emailTpl.heading(args.heading),
      this.emailTpl.paragraph(`Bonjour <strong>${safeName}</strong>,`),
      this.emailTpl.paragraph(safeBody),
      this.emailTpl.infoPanel(this.emailTpl.keyValues(args.infoRows)),
      this.emailTpl.muted(
        'Pour toute question, contactez le support via les coordonnées en bas de ce message.',
      ),
    ].join('\n');
    const text = [
      `Bonjour ${args.recipient.name},`,
      '',
      args.body,
      '',
      ...args.infoRows.map((r) => `${r.label} : ${r.value}`),
      '',
      `— L'équipe ${appName}`,
    ].join('\n');

    try {
      await this.mailer.sendSimple({
        to: args.recipient.email,
        toName: args.recipient.name,
        subject: `${appName} — ${args.subject}`,
        html,
        text,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`${args.logTag} email=${args.recipient.email}: ${msg}`);
    }
  }

  private formatAmount(amount: number, currency: string): string {
    const cur = (currency ?? 'CAD').trim().toUpperCase() || 'CAD';
    const n = Number(amount);
    const safe = Number.isFinite(n) ? n : 0;
    return `${safe.toFixed(2)} ${cur}`;
  }

  private formatDateFr(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}
