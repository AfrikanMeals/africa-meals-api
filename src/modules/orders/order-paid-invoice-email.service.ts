import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { Model, Types } from 'mongoose';
import { OrderInvoicePdfService } from './order-invoice-pdf.service';
import { buildOrderReceiptEmailBodyHtml } from './order-receipt-email-html.util';
import {
  buildOrderEmailJsonLd,
  buildOrderReceiptEmailJsonLd,
  buildOrderReceiptTextLines,
  buildParcelDeliveryEmailJsonLd,
  coordsFromAddressLike,
  formatInvoiceMoney,
  formatOrderDeliveryLine,
  OrderSchemaStatus,
  orderInvoiceRef,
  orderInvoiceTotalCharged,
  orderReceiptEmailSubject,
  firstOrderItemImageUrl,
  resolveOrderEmailPublicUrl,
  type OrderInvoiceSnapshot,
} from './order-invoice.util';

/** Variante d'e-mail de commande (copie + statut Schema.org). */
export type OrderEmailVariant = 'paid' | 'shipped';

type ComposedOrderEmail = {
  snapshot: OrderInvoiceSnapshot;
  clientEmail: string;
  subject: string;
  preheader: string;
  wrappedHtml: string;
  text: string;
  jsonLd: Record<string, unknown> | Record<string, unknown>[];
  pdf?: Buffer;
};

export type OrderEmailDebugSendResult = {
  ok: true;
  sentTo: string;
  originalClientEmail: string;
  subject: string;
  from: string;
  smtpHost: string;
  smtpConfigured: boolean;
  orderId: string;
  orderRef: string;
  variant: OrderEmailVariant;
  jsonLd: Record<string, unknown> | Record<string, unknown>[];
  jsonLdTypes: string[];
  hasJsonLdInHtml: boolean;
  jsonLdInHead: boolean;
  hints: string[];
  sentAt: string;
};

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
    await this.ensurePaidReceiptEmail(orderId);
  }

  /**
   * Envoie le reçu/facture au plus une fois par commande payée.
   * Réessaie si un envoi précédent a échoué (`paidReceiptEmailedAt` absent).
   */
  async ensurePaidReceiptEmail(orderId: string): Promise<void> {
    if (!this.isEnabled()) return;
    const oid = orderId?.trim();
    if (!oid || !Types.ObjectId.isValid(oid)) return;

    const claim = await this.orderModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(oid),
          paidReceiptEmailedAt: { $exists: false },
          status: { $ne: OrderStatusEnum.CREATED },
        },
        { $set: { paidReceiptEmailedAt: new Date() } },
      )
      .select('_id paidReceiptEmailedAt')
      .lean()
      .exec();

    if (!claim) return;

    try {
      const composed = await this.composeOrderEmail(oid, 'paid');
      if (!composed) {
        await this.unclaimPaidReceiptEmail(oid, claim.paidReceiptEmailedAt);
        this.logger.warn(
          `ensurePaidReceiptEmail: e-mail client indisponible order=${oid}`,
        );
        return;
      }

      const ref = orderInvoiceRef(composed.snapshot.orderId);
      await this.mailer.sendSimple({
        to: composed.clientEmail,
        toName: composed.snapshot.clientName,
        subject: composed.subject,
        html: composed.wrappedHtml,
        text: composed.text,
        logContext: 'order-paid-invoice',
        attachments: composed.pdf
          ? [
              {
                filename: `facture-${ref}.pdf`,
                content: composed.pdf,
                contentType: 'application/pdf',
              },
            ]
          : undefined,
      });
    } catch (err) {
      await this.unclaimPaidReceiptEmail(oid, claim.paidReceiptEmailedAt);
      throw err;
    }
  }

  private async unclaimPaidReceiptEmail(
    orderId: string,
    emailedAt?: Date,
  ): Promise<void> {
    await this.orderModel
      .updateOne(
        {
          _id: new Types.ObjectId(orderId),
          ...(emailedAt ? { paidReceiptEmailedAt: emailedAt } : {}),
        },
        { $unset: { paidReceiptEmailedAt: '' } },
      )
      .exec();
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

  /** E-mail « commande en livraison » + balisage Schema.org (Order + ParcelDelivery). */
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
      deliveryTipCents: Math.max(
        0,
        Math.round(Number(order.deliveryTipCents) || 0),
      ),
      orderPaymentFeeCents: Math.max(
        0,
        Math.round(Number(order.orderPaymentFeeCents) || 0),
      ),
      shouldShip: Boolean(order.shouldShip),
      currency:
        typeof order.currency === 'string' ? order.currency : undefined,
      couponCode:
        typeof order.couponCode === 'string' ? order.couponCode : undefined,
      couponDiscountAmount:
        order.couponDiscountAmount != null
          ? Number(order.couponDiscountAmount)
          : undefined,
      giftCode:
        typeof order.giftCode === 'string' ? order.giftCode : undefined,
      giftCodeDiscountAmount:
        order.giftCodeDiscountAmount != null
          ? Number(order.giftCodeDiscountAmount)
          : undefined,
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

  resolveSmtpFromAddress(): string {
    return (
      this.config.get<string>('SMTP_FROM')?.trim() ||
      this.config.get<string>('SMTP_USER')?.trim() ||
      ''
    );
  }

  isSmtpConfigured(): boolean {
    const user = this.config.get<string>('SMTP_USER')?.trim() ?? '';
    const pass =
      this.config.get<string>('SMTP_APP_PASSWORD')?.trim() ||
      this.config.get<string>('SMTP_PASS')?.trim() ||
      '';
    return Boolean(user && pass.replace(/\s/g, ''));
  }

  /** Envoie un e-mail de commande réel à une adresse de test (admin Email Debug). */
  async sendDebugOrderEmail(
    orderId: string,
    variant: OrderEmailVariant,
    toEmail: string,
  ): Promise<OrderEmailDebugSendResult> {
    if (variant === 'paid' && !this.isEnabled()) {
      throw new BadRequestException('order_receipt_email_disabled');
    }
    if (variant === 'shipped' && !this.isShippedEnabled()) {
      throw new BadRequestException('order_shipped_email_disabled');
    }
    if (!this.isSmtpConfigured()) {
      throw new BadRequestException('smtp_not_configured');
    }

    const composed = await this.composeOrderEmail(orderId, variant);
    if (!composed) {
      throw new BadRequestException('order_email_debug_no_snapshot');
    }

    const to = toEmail.trim().toLowerCase();
    const ref = orderInvoiceRef(composed.snapshot.orderId);
    const logTag = `order-email-debug-${variant}`;

    await this.mailer.sendSimple({
      to,
      toName: composed.snapshot.clientName,
      subject: composed.subject,
      html: composed.wrappedHtml,
      text: composed.text,
      logContext: logTag,
      attachments: composed.pdf
        ? [
            {
              filename: `facture-${ref}.pdf`,
              content: composed.pdf,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });

    const from = this.resolveSmtpFromAddress();
    const fromDomain = from.includes('@') ? from.split('@')[1] ?? '' : '';
    const hints = [
      'Ouvrez l’e-mail dans Gmail (web ou mobile) et attendez 1–5 minutes avant de juger l’affichage.',
      'Carte résumé au-dessus du corps : commande #, restaurant, total, statut (si whitelist Google OK).',
      'Onglet Achats (mobile) : regroupement avec d’autres reçus si le balisage Order est accepté.',
      'Vérifiez « Afficher l’original » : Authentication-Results doit montrer SPF/DKIM pass pour wise-eat.com.',
      'Si rien n’apparaît : validez le HTML sur le Email Markup Tester Google, puis enregistrez le domaine expéditeur.',
    ];
    if (fromDomain && to.endsWith('@gmail.com') && from.toLowerCase() !== to) {
      hints.unshift(
        `Test sans whitelist : From (${from}) ≠ To (${to}). Pour un test Gmail auto-validé, envoyez depuis et vers le même @gmail.com (mot de passe d’application). Depuis @${fromDomain}, l’enregistrement Google est requis pour la carte Achats.`,
      );
    }

    return {
      ok: true,
      sentTo: to,
      originalClientEmail: composed.clientEmail,
      subject: composed.subject,
      from,
      smtpHost:
        this.config.get<string>('SMTP_HOST')?.trim() || 'smtp.gmail.com',
      smtpConfigured: true,
      orderId: composed.snapshot.orderId,
      orderRef: ref,
      variant,
      jsonLd: composed.jsonLd,
      jsonLdTypes: this.extractJsonLdTypes(composed.jsonLd),
      hasJsonLdInHtml: composed.wrappedHtml.includes('application/ld+json'),
      jsonLdInHead: this.jsonLdAppearsInHead(composed.wrappedHtml),
      hints,
      sentAt: new Date().toISOString(),
    };
  }

  private extractJsonLdTypes(
    jsonLd: Record<string, unknown> | Record<string, unknown>[],
  ): string[] {
    const list = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
    return list
      .map((entry) => String(entry['@type'] ?? '').trim())
      .filter((t) => t.length > 0);
  }

  private jsonLdAppearsInHead(html: string): boolean {
    const headClose = html.toLowerCase().indexOf('</head>');
    const ld = html.indexOf('application/ld+json');
    return headClose > 0 && ld > 0 && ld < headClose;
  }

  /** Compose l'e-mail (corps + PDF + JSON-LD) sans envoi. */
  private async composeOrderEmail(
    orderId: string,
    variant: OrderEmailVariant,
  ): Promise<ComposedOrderEmail | null> {
    const logTag =
      variant === 'paid' ? 'order-paid-invoice' : 'order-shipped';
    const loaded = await this.loadSnapshot(orderId, logTag);
    if (!loaded) return null;
    const { snapshot, email } = loaded;

    const ref = orderInvoiceRef(snapshot.orderId);
    const esc = this.emailTemplate.escapeHtml.bind(this.emailTemplate);
    const storeEsc = esc(snapshot.storeName);
    const orderUrl = this.resolveOrderUrl(snapshot.orderId);
    const publicWebUrl = this.resolvePublicWebUrl();
    const amountStr = formatInvoiceMoney(
      orderInvoiceTotalCharged(snapshot),
      snapshot.currency,
    );
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
        ...buildOrderReceiptTextLines(snapshot),
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
      orderStatus = OrderSchemaStatus.processing;
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

    return {
      snapshot,
      clientEmail: email,
      subject,
      preheader,
      wrappedHtml,
      text,
      jsonLd,
      pdf,
    };
  }

  /** Compose et envoie l'e-mail (corps + PDF + JSON-LD) selon la variante. */
  private async sendOrderEmail(
    orderId: string,
    variant: OrderEmailVariant,
  ): Promise<void> {
    const composed = await this.composeOrderEmail(orderId, variant);
    if (!composed) return;

    const ref = orderInvoiceRef(composed.snapshot.orderId);
    const logTag =
      variant === 'paid' ? 'order-paid-invoice' : 'order-shipped';

    await this.mailer.sendSimple({
      to: composed.clientEmail,
      toName: composed.snapshot.clientName,
      subject: composed.subject,
      html: composed.wrappedHtml,
      text: composed.text,
      logContext: logTag,
      attachments: composed.pdf
        ? [
            {
              filename: `facture-${ref}.pdf`,
              content: composed.pdf,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });
  }
}
