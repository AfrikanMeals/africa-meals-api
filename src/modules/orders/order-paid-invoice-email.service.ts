import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel } from '@schemas/order.schema';
import { Model, Types } from 'mongoose';
import { OrderInvoicePdfService } from './order-invoice-pdf.service';
import { buildOrderReceiptEmailBodyHtml } from './order-receipt-email-html.util';
import {
  buildOrderEmailJsonLd,
  buildOrderReceiptEmailJsonLd,
  buildParcelDeliveryEmailJsonLd,
  coordsFromAddressLike,
  formatInvoiceMoney,
  formatOrderDeliveryLine,
  OrderSchemaStatus,
  orderInvoiceRef,
  orderReceiptEmailSubject,
  firstOrderItemImageUrl,
  resolveOrderEmailPublicUrl,
  type OrderInvoiceSnapshot,
} from './order-invoice.util';

/** Variante d'e-mail de commande (copie + statut Schema.org). */
type OrderEmailVariant = 'paid' | 'shipped';

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

  private isFlagDisabled(key: string): boolean {
    const raw = this.config.get<string>(key)?.trim() ?? '';
    return raw === '1' || raw.toLowerCase() === 'true';
  }

  isEnabled(): boolean {
    return !this.isFlagDisabled('DISABLE_ORDER_PAID_INVOICE_EMAIL');
  }

  isShippedEnabled(): boolean {
    return !this.isFlagDisabled('DISABLE_ORDER_SHIPPED_EMAIL');
  }

  /** E-mail de reçu (paiement confirmé) + PDF + balisage achat Schema.org. */
  async sendForPaidOrder(orderId: string): Promise<void> {
    if (!this.isEnabled()) return;
    await this.sendOrderEmail(orderId, 'paid');
  }

  /** Renvoi manuel du reçu client (dashboard vendeur / admin). */
  async resendPaidReceiptToClient(
    orderId: string,
  ): Promise<{ ok: true; sentTo: string }> {
    if (!this.isEnabled()) {
      throw new BadRequestException('order_receipt_email_disabled');
    }
    const loaded = await this.loadSnapshot(orderId, 'order-receipt-resend');
    if (!loaded) {
      throw new BadRequestException('order_receipt_no_client_email');
    }
    const st = String(loaded.snapshot.status ?? '').toLowerCase();
    if (st === 'created') {
      throw new BadRequestException('order_not_paid');
    }
    await this.sendOrderEmail(orderId, 'paid');
    return { ok: true, sentTo: loaded.email };
  }

  /** E-mail « commande en livraison » + balisage Schema.org (OrderInTransit). */
  async sendForShippedOrder(orderId: string): Promise<void> {
    if (!this.isShippedEnabled()) return;
    await this.sendOrderEmail(orderId, 'shipped');
  }

  /** URL publique de la commande (JSON-LD + bouton « Voir la commande »). */
  private resolvePublicWebUrl(): string {
    return (
      this.config.get<string>('PUBLIC_WEB_URL')?.trim() ||
      this.config.get<string>('EMAIL_WEBSITE_URL')?.trim() ||
      this.config.get<string>('CLIENT_APP_URL')?.trim() ||
      'https://wise-eat.com'
    );
  }

  private resolveOrderUrl(orderId: string): string {
    return (
      resolveOrderEmailPublicUrl(orderId, {
        orderUrlTemplate: this.config.get<string>('EMAIL_ORDER_URL_TEMPLATE'),
        publicWebUrl: this.resolvePublicWebUrl(),
        clientAppUrl: this.config.get<string>('CLIENT_APP_URL'),
        emailWebsiteUrl: this.config.get<string>('EMAIL_WEBSITE_URL'),
      }) ?? `${this.resolvePublicWebUrl()}/orders/${encodeURIComponent(orderId.trim())}`
    );
  }

  /** Charge la commande, vérifie l'e-mail client et construit le snapshot facture. */
  private async loadSnapshot(
    orderId: string,
    logTag: string,
  ): Promise<{ snapshot: OrderInvoiceSnapshot; email: string } | null> {
    const oid = orderId?.trim();
    if (!oid || !Types.ObjectId.isValid(oid)) return null;

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
      .populate({
        path: 'assignedDeliveryUser',
        select: 'fullName',
      })
      .lean()
      .exec();

    if (!order) {
      this.logger.warn(`${logTag}: commande introuvable ${oid}`);
      return null;
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
      this.logger.warn(`${logTag}: pas d'e-mail client order=${oid}`);
      return null;
    }

    const storeRaw = order.store as unknown as
      | {
          _id?: Types.ObjectId;
          name?: string;
          address?: {
            address?: string;
            city?: string;
            zipCode?: string;
            zip_code?: string;
            country?: string;
            countryCode?: string;
            country_code?: string;
            location?: { coordinates?: number[] };
          };
        }
      | null
      | undefined;
    const storeName = storeRaw?.name?.trim() || 'Restaurant';
    const storeId = storeRaw?._id ? String(storeRaw._id) : undefined;
    const addr = storeRaw?.address;
    const storeAddressLine = addr
      ? [addr.address, addr.city, addr.zipCode ?? addr.zip_code]
          .filter(Boolean)
          .join(', ')
      : '';
    const storeAddressSnapshot = addr
      ? {
          address: addr.address,
          city: addr.city,
          zipCode: addr.zipCode ?? addr.zip_code,
          country: addr.country,
          countryCode: addr.countryCode ?? addr.country_code,
          location: addr.location,
        }
      : undefined;
    const storeAddressCoords = coordsFromAddressLike(addr);

    const agentRaw = order.assignedDeliveryUser as
      | { fullName?: string }
      | null
      | undefined;
    const carrierName = agentRaw?.fullName?.trim() || undefined;

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
      storeId,
      createdAt: order.createdAt,
      status: String(order.status ?? 'paied'),
      totalPrice: Number(order.totalPrice) || 0,
      subtotalBeforeTax: Number(order.subtotalBeforeTax) || undefined,
      taxTotal: Number(order.taxTotal) || undefined,
      taxLines: Array.isArray(order.taxLines)
        ? order.taxLines.map((t) => ({
            name: String((t as { name?: string }).name ?? 'Taxe'),
            description: (t as { description?: string }).description,
            amount: Number((t as { amount?: number }).amount) || 0,
          }))
        : undefined,
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
      storeAddressSnapshot,
      storeAddressCoords,
      carrierName,
      clientName: userRaw?.fullName?.trim() || email,
      clientEmail: email,
      deliveryLine,
      deliveryAddressSnapshot: snap,
      items: order.items ?? [],
    };

    return { snapshot, email };
  }

  /** Compose et envoie l'e-mail (corps + PDF + JSON-LD) selon la variante. */
  private async sendOrderEmail(
    orderId: string,
    variant: OrderEmailVariant,
  ): Promise<void> {
    const logTag =
      variant === 'paid' ? 'order-paid-invoice' : 'order-shipped';
    const loaded = await this.loadSnapshot(orderId, logTag);
    if (!loaded) return;
    const { snapshot, email } = loaded;

    const ref = orderInvoiceRef(snapshot.orderId);
    const esc = this.emailTemplate.escapeHtml.bind(this.emailTemplate);
    const storeEsc = esc(snapshot.storeName);
    const orderUrl = this.resolveOrderUrl(snapshot.orderId);
    const publicWebUrl = this.resolvePublicWebUrl();
    const amountStr = formatInvoiceMoney(snapshot.totalPrice, snapshot.currency);
    const currency =
      (snapshot.currency || 'CAD').trim().toUpperCase() || 'CAD';
    const brand = this.emailTemplate.getBrand();
    const orderDateIso = snapshot.createdAt
      ? new Date(snapshot.createdAt).toISOString()
      : undefined;

    const pickupHtml = snapshot.pickupCode?.trim()
      ? [
          this.emailTemplate.paragraph('<strong>Code retrait</strong>'),
          this.emailTemplate.codeBox(snapshot.pickupCode.trim().toUpperCase()),
        ].join('')
      : '';

    const ctaHtml = orderUrl
      ? this.emailTemplate.button('Voir la commande', orderUrl)
      : '';

    let heading: string;
    let intro: string;
    let subject: string;
    let preheader: string;
    let orderStatus: string;
    let withPdf: boolean;
    let textLines: string[];

    if (variant === 'paid') {
      heading = 'Merci pour votre commande';
      intro = `Votre commande chez <strong>${storeEsc}</strong> est confirmée.`;
      subject = orderReceiptEmailSubject(snapshot.storeName, ref);
      preheader = `Order #${ref} complete — ${amountStr}`;
      orderStatus = OrderSchemaStatus.processing;
      withPdf = true;
      textLines = [
        `Merci pour votre commande chez ${snapshot.storeName}`,
        `Commande #${ref}`,
        snapshot.deliveryLine,
        snapshot.pickupCode?.trim()
          ? `Code retrait : ${snapshot.pickupCode.trim().toUpperCase()}`
          : '',
        'La facture PDF est jointe à ce message.',
      ];
    } else {
      heading = 'Commande en livraison';
      intro = `Bonne nouvelle ! Votre commande chez <strong>${storeEsc}</strong> est en cours de livraison.`;
      subject = `${snapshot.storeName} Order #${ref} — Shipped`;
      preheader = `Order #${ref} in transit`;
      orderStatus = OrderSchemaStatus.inTransit;
      withPdf = false;
      textLines = [
        `Commande en livraison — ${snapshot.storeName}`,
        `Référence commande : ${ref}`,
        snapshot.deliveryLine,
        orderUrl ? `Suivre la commande : ${orderUrl}` : '',
      ];
    }

    const receiptHtml =
      variant === 'paid'
        ? buildOrderReceiptEmailBodyHtml(snapshot, {
            ref,
            orderUrl,
            orderDateIso,
            orderStatusUri: orderStatus,
            currency,
            appName: brand.appName,
          })
        : '';

    const html = (variant === 'paid'
      ? [
          receiptHtml,
          this.emailTemplate.keyValues([
            { label: 'Restaurant', value: storeEsc },
            { label: 'Mode', value: esc(snapshot.deliveryLine) },
          ]),
          pickupHtml,
          this.emailTemplate.paragraph(
            'La facture détaillée (articles, compléments et montants) est jointe en PDF à ce message.',
          ),
          ctaHtml,
          this.emailTemplate.muted(
            'Conservez ce message pour vos archives. Pour toute question, répondez à cet e-mail ou contactez le restaurant.',
          ),
        ]
      : [
          this.emailTemplate.heading(heading),
          this.emailTemplate.paragraph(intro),
          this.emailTemplate.keyValues([
            { label: 'Référence', value: esc(ref) },
            { label: 'Restaurant', value: storeEsc },
            { label: 'Mode', value: esc(snapshot.deliveryLine) },
          ]),
          pickupHtml,
          ctaHtml,
          this.emailTemplate.muted(
            'Conservez ce message pour vos archives. Pour toute question, répondez à cet e-mail ou contactez le restaurant.',
          ),
        ]
    )
      .filter(Boolean)
      .join('');

    const text = textLines.filter(Boolean).join('\n');

    // Balisage Schema.org « Order » + « Invoice » : carte achat Gmail
    const jsonLdOpts = {
      ref,
      orderStatus,
      orderUrl,
      publicWebUrl,
      merchantLogoUrl:
        brand.logoUrl ?? firstOrderItemImageUrl(snapshot) ?? undefined,
      appName: brand.appName,
      carrierName: snapshot.carrierName,
    };
    const jsonLd =
      variant === 'paid'
        ? buildOrderReceiptEmailJsonLd(snapshot, jsonLdOpts)
        : (() => {
            const orderJsonLd = buildOrderEmailJsonLd(snapshot, jsonLdOpts);
            const parcelJsonLd = buildParcelDeliveryEmailJsonLd(
              snapshot,
              jsonLdOpts,
            );
            return parcelJsonLd ? [orderJsonLd, parcelJsonLd] : orderJsonLd;
          })();
    const wrappedHtml = this.emailTemplate.wrapBody(html, {
      title: subject,
      preheader,
      jsonLd,
    });

    const pdf = withPdf ? await this.invoicePdf.buildPdf(snapshot) : undefined;

    await this.mailer.sendSimple({
      to: email,
      toName: snapshot.clientName,
      subject,
      html: wrappedHtml,
      text,
      logContext: logTag,
      attachments: pdf
        ? [
            {
              filename: `facture-${ref}.pdf`,
              content: pdf,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });
  }
}
