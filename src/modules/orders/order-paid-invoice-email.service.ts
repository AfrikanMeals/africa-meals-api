import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel } from '@schemas/order.schema';
import { Model, Types } from 'mongoose';
import { OrderInvoicePdfService } from './order-invoice-pdf.service';
import {
  formatOrderDeliveryLine,
  orderInvoiceRef,
  type OrderInvoiceSnapshot,
} from './order-invoice.util';

@Injectable()
export class OrderPaidInvoiceEmailService {
  private readonly logger = new Logger(OrderPaidInvoiceEmailService.name);

  constructor(
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    private readonly mailer: MailerService,
    private readonly emailTemplate: EmailTemplateService,
    private readonly invoicePdf: OrderInvoicePdfService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    const raw =
      this.config.get<string>('DISABLE_ORDER_PAID_INVOICE_EMAIL')?.trim() ??
      '';
    return raw !== '1' && raw.toLowerCase() !== 'true';
  }

  async sendForPaidOrder(orderId: string): Promise<void> {
    if (!this.isEnabled()) return;
    const oid = orderId?.trim();
    if (!oid || !Types.ObjectId.isValid(oid)) return;

    const order = await this.orderModel
      .findById(oid)
      .populate({
        path: 'store',
        select: 'name address',
        populate: { path: 'address' },
      })
      .populate({
        path: 'user',
        select: 'fullName email addresses',
        populate: { path: 'addresses' },
      })
      .lean()
      .exec();

    if (!order) {
      this.logger.warn(`order-paid-invoice: commande introuvable ${oid}`);
      return;
    }

    const userRaw = order.user as
      | {
          email?: string;
          fullName?: string;
          addresses?: Array<Record<string, unknown>>;
        }
      | null
      | undefined;
    const email = userRaw?.email?.trim();
    if (!email) {
      this.logger.warn(`order-paid-invoice: pas d'e-mail client order=${oid}`);
      return;
    }

    const storeRaw = order.store as
      | {
          name?: string;
          address?: {
            address?: string;
            city?: string;
            zipCode?: string;
          };
        }
      | null
      | undefined;
    const storeName = storeRaw?.name?.trim() || 'Restaurant';
    const addr = storeRaw?.address;
    const storeAddressLine = addr
      ? [addr.address, addr.city, addr.zipCode].filter(Boolean).join(', ')
      : '';

    const snap = order.deliveryAddressSnapshot as
      | Record<string, unknown>
      | undefined;
    const deliveryLine = formatOrderDeliveryLine({
      shouldShip: Boolean(order.shouldShip),
      deliveryAddressSnapshot: snap,
      userAddresses: userRaw?.addresses,
    });

    const snapshot: OrderInvoiceSnapshot = {
      orderId: oid,
      createdAt: order.createdAt,
      status: String(order.status ?? 'paied'),
      totalPrice: Number(order.totalPrice) || 0,
      shippingPrice: Number(order.shippingPrice) || 0,
      shouldShip: Boolean(order.shouldShip),
      currency:
        typeof order.currency === 'string' ? order.currency : undefined,
      couponCode:
        typeof order.couponCode === 'string' ? order.couponCode : undefined,
      pickupCode:
        typeof order.pickupCode === 'string' ? order.pickupCode : undefined,
      storeName,
      storeAddressLine,
      clientName: userRaw?.fullName?.trim() || email,
      clientEmail: email,
      deliveryLine,
      items: order.items ?? [],
    };

    const pdf = await this.invoicePdf.buildPdf(snapshot);
    const ref = orderInvoiceRef(oid);
    const esc = this.emailTemplate.escapeHtml.bind(this.emailTemplate);
    const storeEsc = esc(storeName);
    const refEsc = esc(ref);

    const pickupHtml = snapshot.pickupCode?.trim()
      ? [
          this.emailTemplate.paragraph('<strong>Code retrait</strong>'),
          this.emailTemplate.codeBox(
            snapshot.pickupCode.trim().toUpperCase(),
          ),
        ].join('')
      : '';

    const html = [
      this.emailTemplate.heading('Paiement confirmé'),
      this.emailTemplate.paragraph(
        `Merci pour votre commande chez <strong>${storeEsc}</strong>. Votre paiement a bien été enregistré.`,
      ),
      this.emailTemplate.keyValues([
        { label: 'Référence', value: refEsc },
        { label: 'Restaurant', value: storeEsc },
        { label: 'Mode', value: esc(deliveryLine) },
      ]),
      pickupHtml,
      this.emailTemplate.paragraph(
        'Vous trouverez en pièce jointe la facture au format PDF (détail des articles, compléments et montants).',
      ),
      this.emailTemplate.muted(
        'Conservez ce message pour vos archives. Pour toute question, répondez à cet e-mail ou contactez le restaurant.',
      ),
    ].join('');

    const text = [
      `Paiement confirmé — ${storeName}`,
      `Référence commande : ${ref}`,
      deliveryLine,
      snapshot.pickupCode?.trim()
        ? `Code retrait : ${snapshot.pickupCode.trim().toUpperCase()}`
        : '',
      'La facture PDF est jointe à ce message.',
    ]
      .filter(Boolean)
      .join('\n');

    await this.mailer.sendSimple({
      to: email,
      toName: snapshot.clientName,
      subject: `${storeName} — Facture commande #${ref}`,
      html,
      text,
      logContext: 'order-paid-invoice',
      attachments: [
        {
          filename: `facture-${ref}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
  }
}
