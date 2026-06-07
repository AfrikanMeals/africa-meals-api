import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  VendorNotificationDispatchService,
  type VendorStoreNotifyEmail,
} from '@modules/vendor-notifications/vendor-notification-dispatch.service';
import {
  vendorOrderEmailEventToCategory,
  type VendorNotificationCategory,
} from '@modules/vendor-notifications/vendor-notification.constants';
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

export type VendorOrderEmailEvent =
  | 'new_order'
  | 'order_paid'
  | 'order_ready'
  | 'order_shipped'
  | 'order_cancelled'
  | 'order_completed';

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
    private readonly vendorDispatch: VendorNotificationDispatchService,
  ) {}

  buildVendorOrderEmailPayload(args: {
    storeId: string;
    orderId: string;
    event: VendorOrderEmailEvent;
    storeName?: string;
    totalPrice?: number;
    currency?: string;
    itemCount?: number;
    note?: string;
    statusLabel?: string;
  }): VendorStoreNotifyEmail {
    const storeName = (args.storeName ?? '').trim() || 'Restaurant';
    const orderRef = this.orderRefLabel(args.orderId);
    const copy = this.vendorOrderEmailCopy({
      event: args.event,
      storeName,
      orderRef,
      totalPrice: args.totalPrice,
      currency: args.currency,
      itemCount: args.itemCount,
      note: args.note,
      statusLabel: args.statusLabel,
    });
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Commande', value: orderRef },
      { label: 'Restaurant', value: storeName },
      { label: 'Statut', value: copy.statusLabel },
    ];
    if (args.itemCount != null && args.itemCount > 0) {
      rows.push({ label: 'Articles', value: String(args.itemCount) });
    }
    if (args.totalPrice != null && Number.isFinite(args.totalPrice)) {
      rows.push({
        label: 'Montant',
        value: this.formatAmount(args.totalPrice, args.currency ?? 'CAD'),
      });
    }
    if (args.note?.trim()) {
      rows.push({ label: 'Détail', value: args.note.trim() });
    }
    return {
      subject: copy.subject,
      heading: copy.heading,
      body: copy.body,
      infoRows: rows,
    };
  }

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

  async notifyVendorOrderEvent(args: {
    storeId: string;
    orderId: string;
    event: VendorOrderEmailEvent;
    storeName?: string;
    totalPrice?: number;
    currency?: string;
    itemCount?: number;
    note?: string;
    statusLabel?: string;
  }): Promise<void> {
    const storeName =
      (args.storeName ?? '').trim() || (await this.storeName(args.storeId));
    const orderRef = this.orderRefLabel(args.orderId);
    const copy = this.vendorOrderEmailCopy({
      event: args.event,
      storeName,
      orderRef,
      totalPrice: args.totalPrice,
      currency: args.currency,
      itemCount: args.itemCount,
      note: args.note,
      statusLabel: args.statusLabel,
    });
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Commande', value: orderRef },
      { label: 'Restaurant', value: storeName },
      { label: 'Statut', value: copy.statusLabel },
    ];
    if (args.itemCount != null && args.itemCount > 0) {
      rows.push({
        label: 'Articles',
        value: String(args.itemCount),
      });
    }
    if (args.totalPrice != null && Number.isFinite(args.totalPrice)) {
      rows.push({
        label: 'Montant',
        value: this.formatAmount(args.totalPrice, args.currency ?? 'CAD'),
      });
    }
    if (args.note?.trim()) {
      rows.push({ label: 'Détail', value: args.note.trim() });
    }

    await this.sendToStoreRecipients({
      storeId: args.storeId,
      category: vendorOrderEmailEventToCategory(args.event),
      subject: copy.subject,
      heading: copy.heading,
      body: copy.body,
      infoRows: rows,
      pushTitle: copy.subject,
      metadata: { orderId: args.orderId, event: args.event },
      logTag: `vendor_order_${args.event} store=${args.storeId} order=${args.orderId}`,
    });
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
      category: 'marketing',
      subject: 'Statut de campagne publicitaire mis à jour',
      heading: 'Campagne publicitaire',
      body,
      infoRows: [
        { label: 'Campagne', value: args.campaignTitle.trim() || 'Sans titre' },
        { label: 'Restaurant', value: storeName },
        { label: 'Nouveau statut', value: next },
      ],
      pushTitle: 'Campagne publicitaire',
      metadata: { campaignId: args.campaignId },
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
      category: 'marketing',
      subject: 'Statut de bannière mis à jour',
      heading: 'Bannière publicitaire',
      body,
      infoRows: [
        { label: 'Bannière', value: args.bannerTitle.trim() || 'Sans titre' },
        { label: 'Restaurant', value: storeName },
        { label: 'Nouveau statut', value: next },
      ],
      pushTitle: 'Bannière publicitaire',
      metadata: { bannerId: args.bannerId },
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
      category: 'refund',
      subject: title,
      heading: 'Remboursement client',
      body,
      infoRows: rows,
      pushTitle: title,
      metadata: { orderId: args.orderId, kind: args.kind },
      logTag: `vendor_refund_status store=${args.storeId} order=${args.orderId} kind=${args.kind}`,
    });
  }

  private orderRefLabel(orderId: string): string {
    const id = orderId.trim();
    const tail = id.length > 6 ? id.slice(-6).toUpperCase() : id.toUpperCase();
    return `#${tail}`;
  }

  private vendorOrderEmailCopy(args: {
    event: VendorOrderEmailEvent;
    storeName: string;
    orderRef: string;
    totalPrice?: number;
    currency?: string;
    itemCount?: number;
    note?: string;
    statusLabel?: string;
  }): { subject: string; heading: string; body: string; statusLabel: string } {
    const amountStr =
      args.totalPrice != null && Number.isFinite(args.totalPrice)
        ? this.formatAmount(args.totalPrice, args.currency ?? 'CAD')
        : '';
    const amountPart = amountStr ? ` (${amountStr})` : '';
    const notePart = args.note?.trim() ? ` ${args.note.trim()}` : '';

    switch (args.event) {
      case 'new_order':
        return {
          subject: 'Nouvelle commande reçue',
          heading: 'Nouvelle commande',
          body: `${args.storeName} a reçu une nouvelle commande ${args.orderRef}${amountPart}. Le paiement est en attente.`,
          statusLabel: args.statusLabel ?? 'En attente de paiement',
        };
      case 'order_paid':
        return {
          subject: 'Commande payée',
          heading: 'Commande payée',
          body: `La commande ${args.orderRef} pour ${args.storeName} a été payée${amountPart}. Vous pouvez la préparer.`,
          statusLabel: args.statusLabel ?? 'Payée',
        };
      case 'order_ready':
        return {
          subject: 'Commande prête',
          heading: 'Commande prête',
          body: `La commande ${args.orderRef} pour ${args.storeName} est prête.${notePart}`,
          statusLabel: args.statusLabel ?? 'Prête',
        };
      case 'order_shipped':
        return {
          subject: 'Commande en livraison',
          heading: 'Commande en livraison',
          body: `La commande ${args.orderRef} pour ${args.storeName} est en cours de livraison.${notePart}`,
          statusLabel: args.statusLabel ?? 'En livraison',
        };
      case 'order_cancelled':
        return {
          subject: 'Commande annulée',
          heading: 'Commande annulée',
          body: `La commande ${args.orderRef} pour ${args.storeName} a été annulée.${notePart}`,
          statusLabel: args.statusLabel ?? 'Annulée',
        };
      case 'order_completed':
        return {
          subject: 'Commande terminée',
          heading: 'Commande terminée',
          body: `La commande ${args.orderRef} pour ${args.storeName} est terminée.`,
          statusLabel: args.statusLabel ?? 'Terminée',
        };
    }
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
    category: VendorNotificationCategory;
    subject: string;
    heading: string;
    body: string;
    infoRows: Array<{ label: string; value: string }>;
    logTag: string;
    pushTitle?: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    await this.vendorDispatch.notifyStoreVendors({
      storeId: args.storeId,
      category: args.category,
      email: {
        subject: args.subject,
        heading: args.heading,
        body: args.body,
        infoRows: args.infoRows,
      },
      push: args.pushTitle
        ? {
            title: args.pushTitle,
            body: args.body,
          }
        : undefined,
      smsBody: args.body,
      metadata: args.metadata,
      logTag: args.logTag,
    });
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
