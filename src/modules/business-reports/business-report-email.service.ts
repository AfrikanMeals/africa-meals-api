import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  BusinessStoreReportCategoryEnum,
  BusinessStoreReportModel,
  BusinessStoreReportSeverityEnum,
} from '@schemas/business-store-report.schema';
import { Model, Types } from 'mongoose';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { vendorOrderStatusLabelFr } from '@modules/orders/vendor-order-paid-message.util';
import { BusinessReportEmailRecipient } from './dto/send-business-report-email.dto';

const CATEGORY_LABELS: Record<BusinessStoreReportCategoryEnum, string> = {
  [BusinessStoreReportCategoryEnum.SERVICE]: 'Service',
  [BusinessStoreReportCategoryEnum.QUALITY]: 'Qualité',
  [BusinessStoreReportCategoryEnum.HYGIENE]: 'Hygiène',
  [BusinessStoreReportCategoryEnum.BILLING]: 'Facturation',
  [BusinessStoreReportCategoryEnum.OTHER]: 'Autre',
};

const SEVERITY_LABELS: Record<BusinessStoreReportSeverityEnum, string> = {
  [BusinessStoreReportSeverityEnum.LOW]: 'Faible',
  [BusinessStoreReportSeverityEnum.MEDIUM]: 'Moyenne',
  [BusinessStoreReportSeverityEnum.HIGH]: 'Élevée',
};

@Injectable()
export class BusinessReportEmailService {
  constructor(
    @InjectModel(BusinessStoreReportModel.name)
    private readonly reportModel: Model<BusinessStoreReportModel>,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly emailTpl: EmailTemplateService,
  ) {}

  async sendAdminEmail(args: {
    reportId: string;
    recipient: BusinessReportEmailRecipient;
    message: string;
    subject?: string;
  }): Promise<{ success: true; message: string }> {
    const id = String(args.reportId ?? '').trim();
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('report_not_found');
    }

    const row = await this.reportModel
      .findById(id)
      .populate({
        path: 'store',
        select: 'name email',
        populate: { path: 'owner', select: 'fullName email' },
      })
      .populate({ path: 'order', select: 'status totalPrice' })
      .populate({ path: 'reporterUser', select: 'fullName email' })
      .lean()
      .exec();

    if (!row) {
      throw new NotFoundException('report_not_found');
    }

    const appName =
      this.configService.get<string>('APP_NAME')?.trim() || 'Wise Eat';
    const supportEmail =
      this.configService.get<string>('SUPPORT_EMAIL')?.trim() ||
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      'help@wise-eat.com';

    const store = row.store as Record<string, unknown> | null;
    const owner = store?.['owner'] as Record<string, unknown> | null;
    const order = row.order as Record<string, unknown> | null;
    const reporter = row.reporterUser as Record<string, unknown> | null;

    const storeName =
      typeof store?.['name'] === 'string' && store['name'].trim()
        ? String(store['name']).trim()
        : 'Boutique';

    const categoryCode = row.category ?? BusinessStoreReportCategoryEnum.OTHER;
    const categoryLabel = CATEGORY_LABELS[categoryCode] ?? categoryCode;

    const createdAtRaw = (row as Record<string, unknown>)['createdAt'];
    const createdAt =
      createdAtRaw instanceof Date
        ? createdAtRaw
        : createdAtRaw
          ? new Date(String(createdAtRaw))
          : new Date();

    const sentAt = createdAt.toLocaleString('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Toronto',
    });

    const details = String(row.details ?? '').trim();
    const severity =
      row.severity &&
      Object.values(BusinessStoreReportSeverityEnum).includes(row.severity)
        ? SEVERITY_LABELS[row.severity]
        : null;

    const orderId =
      order && order['_id'] != null ? String(order['_id']) : null;
    const shortOrderId = orderId ? orderId.slice(-8).toUpperCase() : null;
    const orderStatus =
      typeof order?.['status'] === 'string'
        ? vendorOrderStatusLabelFr(
            String(order['status']),
            undefined,
            order['payOnPickup'] === true || order['pay_on_pickup'] === true,
          )
        : null;
    const totalPriceRaw = order?.['totalPrice'];
    const totalPrice =
      typeof totalPriceRaw === 'number' && Number.isFinite(totalPriceRaw)
        ? totalPriceRaw
        : totalPriceRaw != null && Number.isFinite(Number(totalPriceRaw))
          ? Number(totalPriceRaw)
          : null;

    const reporterName =
      typeof reporter?.['fullName'] === 'string'
        ? String(reporter['fullName']).trim()
        : '';
    const reporterEmail =
      typeof reporter?.['email'] === 'string' && reporter['email'].trim()
        ? String(reporter['email']).trim()
        : null;

    const vendorEmail =
      (typeof owner?.['email'] === 'string' && owner['email'].trim()
        ? String(owner['email']).trim()
        : null) ||
      (typeof store?.['email'] === 'string' && store['email'].trim()
        ? String(store['email']).trim()
        : null);

    const vendorName =
      typeof owner?.['fullName'] === 'string'
        ? String(owner['fullName']).trim()
        : storeName;

    let to = '';
    let toName = '';
    let subject = args.subject?.trim() || '';
    let heading = '';
    let replyTo: string | undefined = supportEmail;
    let replyToName: string | undefined = appName;

    if (args.recipient === 'vendor') {
      if (!vendorEmail) {
        throw new BadRequestException('report_vendor_email_missing');
      }
      to = vendorEmail;
      toName = vendorName || storeName;
      if (!subject) {
        subject = `[${appName}] Signalement client — ${storeName} — ${categoryLabel}`;
      }
      heading = 'Signalement client';
    } else {
      if (!reporterEmail) {
        throw new BadRequestException('report_customer_email_missing');
      }
      to = reporterEmail;
      toName = reporterName || 'Client';
      if (!subject) {
        subject = `[${appName}] Suite à votre signalement — ${storeName}`;
      }
      heading = 'Suite à votre signalement';
      replyTo = supportEmail;
      replyToName = appName;
    }

    const safeMessage = this.emailTpl
      .escapeHtml(args.message.trim())
      .replace(/\n/g, '<br>');
    const safeDetails = this.emailTpl.escapeHtml(details).replace(/\n/g, '<br>');

    const summaryRows: Array<{ label: string; value: string }> = [
      { label: 'Boutique', value: storeName },
      { label: 'Date', value: sentAt },
      { label: 'Catégorie', value: categoryLabel },
    ];
    if (severity) summaryRows.push({ label: 'Gravité', value: severity });
    if (shortOrderId) {
      let orderValue = shortOrderId;
      if (orderStatus) orderValue += ` (${orderStatus})`;
      if (totalPrice != null) orderValue += ` — ${totalPrice.toFixed(2)}`;
      summaryRows.push({ label: 'Commande', value: orderValue });
    }
    if (reporterName) {
      summaryRows.push({
        label: 'Client',
        value: reporterName,
      });
    }

    const html = [
      this.emailTpl.heading(heading),
      this.emailTpl.paragraph(safeMessage),
      this.emailTpl.divider(),
      this.emailTpl.muted('Récapitulatif du signalement :'),
      this.emailTpl.keyValues(summaryRows),
      this.emailTpl.divider(),
      this.emailTpl.muted('Message original du client :'),
      this.emailTpl.infoPanel(this.emailTpl.paragraph(safeDetails)),
      args.recipient === 'customer'
        ? this.emailTpl.muted(
            'Vous pouvez répondre directement à cet e-mail pour poursuivre la conversation avec notre équipe.',
          )
        : this.emailTpl.muted(
            'Merci de nous indiquer les mesures prises en réponse à ce signalement.',
          ),
    ]
      .filter(Boolean)
      .join('\n');

    const textSummary = summaryRows
      .map((r) => `${r.label} : ${r.value}`)
      .join('\n');

    const text = [
      args.message.trim(),
      '',
      '—',
      'Récapitulatif du signalement :',
      textSummary,
      '',
      'Message original du client :',
      details,
      '',
      args.recipient === 'customer'
        ? 'Répondez à cet e-mail pour nous recontacter.'
        : 'Merci de nous indiquer les mesures prises en réponse à ce signalement.',
      '',
      `L’équipe ${appName}`,
      supportEmail,
    ].join('\n');

    await this.mailerService.sendSimple({
      to,
      toName,
      subject: subject.slice(0, 200),
      html,
      text,
      replyTo,
      replyToName,
      logContext: `business-report-${args.recipient}`,
    });

    return {
      success: true,
      message:
        args.recipient === 'vendor'
          ? 'E-mail envoyé au vendeur.'
          : 'E-mail envoyé au client.',
    };
  }
}
