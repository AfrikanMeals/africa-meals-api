import { escapeEmailHtml } from '@modules/mailer/email-brand.util';
import { fromStripeMinorUnits } from '@utils/stripe-currency-amount.util';
import {
  formatInvoiceMoney,
  inferInvoicePaymentMethodLabel,
  type OrderInvoiceSnapshot,
} from './order-invoice.util';

export type OrderReceiptEmailHtmlOptions = {
  ref: string;
  orderUrl?: string;
  orderDateIso?: string;
  orderStatusUri?: string;
  currency: string;
  appName?: string;
};

function firstProductImage(snapshot: OrderInvoiceSnapshot): string | undefined {
  for (const it of snapshot.items ?? []) {
    const row = it as { pictureUrl?: string; picture_url?: string };
    const url = String(row.pictureUrl ?? row.picture_url ?? '').trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return undefined;
}

function summarizeOrderItems(snapshot: OrderInvoiceSnapshot): string {
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  if (!items.length) return 'Commande';
  return items
    .map((it) => {
      const name = String(it.label ?? '').trim() || 'Article';
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
      return qty > 1 ? `${name} × ${qty}` : name;
    })
    .join(', ');
}

/** Carte résumé style Gmail (visible dans tous les clients mail). */
export function buildOrderReceiptSummaryCardHtml(
  snapshot: OrderInvoiceSnapshot,
  opts: Pick<OrderReceiptEmailHtmlOptions, 'ref' | 'orderUrl' | 'currency' | 'appName'>,
): string {
  const esc = escapeEmailHtml;
  const storeName = snapshot.storeName.trim() || 'Restaurant';
  const itemsLabel = esc(summarizeOrderItems(snapshot));
  const primaryName = esc(
    String(snapshot.items?.[0]?.label ?? '').trim() || storeName,
  );
  const total = formatInvoiceMoney(
    Number(snapshot.totalPrice) || 0,
    opts.currency,
  );
  const orderUrl = opts.orderUrl?.trim() ?? '';
  const thumb = firstProductImage(snapshot);
  const appName = esc((opts.appName ?? 'Wise Eat').trim() || 'Wise Eat');

  const thumbCell = thumb
    ? `<td width="56" valign="top" style="padding-right:12px;">
        <img src="${thumb.replace(/"/g, '&quot;')}" alt="" width="48" height="48"
          style="display:block;width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb;" />
      </td>`
    : '';

  const linkOpen = orderUrl
    ? `<a href="${orderUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit;">`
    : '';
  const linkClose = orderUrl ? '</a>' : '';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #dadce0;border-radius:12px;background:#ffffff;overflow:hidden;">
  <tr>
    <td style="padding:16px 18px;">
      ${linkOpen}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${thumbCell}
          <td valign="top">
            <p style="margin:0 0 4px;font-size:16px;line-height:1.35;font-weight:700;color:#202124;font-family:Arial,sans-serif;">${primaryName}</p>
            <p style="margin:0;font-size:13px;line-height:1.4;color:#5f6368;font-family:Arial,sans-serif;">${esc(storeName)}</p>
          </td>
          <td align="right" valign="top" style="white-space:nowrap;">
            <p style="margin:0;font-size:15px;line-height:1.35;font-weight:700;color:#202124;font-family:Arial,sans-serif;">${esc(total)}</p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;padding-top:14px;border-top:1px solid #e8eaed;">
        <tr>
          <td width="50%" valign="top" style="padding-right:8px;font-size:13px;line-height:1.45;color:#5f6368;font-family:Arial,sans-serif;">
            <span style="font-size:15px;line-height:1;">🏪</span>
            Commande chez ${esc(storeName)}
          </td>
          <td width="50%" valign="top" style="padding-left:8px;font-size:13px;line-height:1.45;color:#5f6368;font-family:Arial,sans-serif;">
            <span style="font-size:15px;line-height:1;">🛒</span>
            Articles&nbsp;: ${itemsLabel}
          </td>
        </tr>
      </table>
      ${linkClose}
      <p style="margin:12px 0 0;font-size:12px;line-height:1.4;color:#9aa0a6;font-family:Arial,sans-serif;">
        Commande #${esc(opts.ref.trim())} · ${appName}
      </p>
    </td>
  </tr>
</table>`.trim();
}

function formatReceiptOrderDate(iso?: Date | string): string {
  if (!iso) return '';
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long' }).format(d);
  } catch {
    return '';
  }
}

function lineSubtotal(item: {
  quantity?: number;
  price?: number;
}): number {
  const qty = Math.max(0, Number(item.quantity) || 0);
  const price = Math.max(0, Number(item.price) || 0);
  return qty * price;
}

/**
 * Corps HTML du reçu (tableau articles + totaux) avec microdata Schema.org Order.
 * Visible dans tous les clients ; complète le JSON-LD pour la carte achat Gmail.
 */
export function buildOrderReceiptEmailBodyHtml(
  snapshot: OrderInvoiceSnapshot,
  opts: OrderReceiptEmailHtmlOptions,
): string {
  const esc = escapeEmailHtml;
  const storeName = snapshot.storeName.trim() || 'Restaurant';
  const ref = opts.ref.trim();
  const currency = opts.currency;
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const linesSubtotal = items.reduce(
    (acc, line) => acc + lineSubtotal(line),
    0,
  );
  const shipping = Math.max(0, Number(snapshot.shippingPrice) || 0);
  const tipCents = Math.max(0, Math.round(Number(snapshot.deliveryTipCents) || 0));
  const tip = fromStripeMinorUnits(tipCents, currency);
  const tax = Math.max(0, Number(snapshot.taxTotal) || 0);
  const total = Math.max(0, Number(snapshot.totalPrice) || 0);
  const discount = Math.max(0, linesSubtotal + shipping + tip + tax - total);
  const paymentLabel = inferInvoicePaymentMethodLabel(snapshot.status);
  const orderDateLabel = formatReceiptOrderDate(snapshot.createdAt);
  const orderDateIso = opts.orderDateIso ?? '';
  const orderUrl = opts.orderUrl?.trim() ?? '';
  const orderStatusUri = opts.orderStatusUri ?? '';

  const orderHeading = orderDateLabel
    ? `Commande #${esc(ref)} (${esc(orderDateLabel)})`
    : `Commande #${esc(ref)}`;

  const productRows = items.length
    ? items
        .map((it) => {
          const name = esc(String(it.label ?? '').trim() || 'Article');
          const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
          const unit = Math.max(0, Number(it.price) || 0);
          const lineTotal = lineSubtotal(it);
          const qtyLabel = qty > 1 ? `${name} × ${qty}` : name;
          return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #ece5d8;font-size:15px;color:#374151;" itemprop="acceptedOffer" itemscope itemtype="http://schema.org/Offer">
          <span itemprop="itemOffered" itemscope itemtype="http://schema.org/Product">
            <span itemprop="name">${qtyLabel}</span>
          </span>
          <meta itemprop="price" content="${unit.toFixed(2)}" />
          <meta itemprop="priceCurrency" content="${esc(currency)}" />
          <span itemprop="eligibleQuantity" itemscope itemtype="http://schema.org/QuantitativeValue">
            <meta itemprop="value" content="${qty}" />
          </span>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid #ece5d8;font-size:15px;color:#374151;font-weight:600;">
          ${esc(formatInvoiceMoney(lineTotal, currency))}
        </td>
      </tr>`;
        })
        .join('')
    : `
      <tr>
        <td colspan="2" style="padding:10px 0;border-bottom:1px solid #ece5d8;font-size:15px;color:#374151;">
          Commande chez ${esc(storeName)}
        </td>
      </tr>`;

  const shippingRow =
    shipping > 0.009
      ? `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Livraison</td>
        <td align="right" style="padding:8px 0;font-size:14px;color:#374151;">${esc(formatInvoiceMoney(shipping, currency))}</td>
      </tr>`
      : '';

  const tipRow =
    tip > 0.009
      ? `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Pourboire livreur</td>
        <td align="right" style="padding:8px 0;font-size:14px;color:#374151;">${esc(formatInvoiceMoney(tip, currency))}</td>
      </tr>`
      : '';

  const taxRow =
    tax > 0.009
      ? `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Taxes</td>
        <td align="right" style="padding:8px 0;font-size:14px;color:#374151;">${esc(formatInvoiceMoney(tax, currency))}</td>
      </tr>`
      : '';

  const discountRow =
    discount > 0.009
      ? `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;">Rabais</td>
        <td align="right" style="padding:8px 0;font-size:14px;color:#16a34a;">−${esc(formatInvoiceMoney(discount, currency))}</td>
      </tr>`
      : '';

  const metaTags = [
    `<meta itemprop="orderNumber" content="${esc(ref)}" />`,
    `<meta itemprop="price" content="${total.toFixed(2)}" />`,
    `<meta itemprop="priceCurrency" content="${esc(currency)}" />`,
    orderDateIso ? `<meta itemprop="orderDate" content="${esc(orderDateIso)}" />` : '',
    orderStatusUri ? `<meta itemprop="orderStatus" content="${esc(orderStatusUri)}" />` : '',
    orderUrl ? `<link itemprop="url" href="${orderUrl.replace(/"/g, '&quot;')}" />` : '',
  ]
    .filter(Boolean)
    .join('\n          ');

  return `
<div itemscope itemtype="http://schema.org/Order" style="margin:8px 0 20px;">
  ${metaTags}
  <span itemprop="merchant" itemscope itemtype="http://schema.org/Organization">
    <meta itemprop="name" content="${esc(storeName)}" />
  </span>
  <span itemprop="customer" itemscope itemtype="http://schema.org/Person">
    <meta itemprop="name" content="${esc(snapshot.clientName.trim() || snapshot.clientEmail)}" />
  </span>

  ${buildOrderReceiptSummaryCardHtml(snapshot, {
    ref,
    orderUrl,
    currency,
    appName: opts.appName,
  })}

  <p style="margin:0 0 10px;font-size:20px;line-height:1.3;font-weight:700;color:#392800;font-family:Arial,sans-serif;">
    Merci pour votre commande
  </p>
  <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#374151;">
    Votre commande chez <strong>${esc(storeName)}</strong> est confirmée.
  </p>

  <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#374151;">
    Bonjour,<br />
    Voici le détail de votre commande pour vos archives.
  </p>

  <p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#392800;">${orderHeading}</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">
    <tr>
      <th align="left" style="padding:0 0 8px;border-bottom:2px solid #392800;font-size:13px;font-weight:700;color:#392800;text-transform:uppercase;letter-spacing:0.04em;">Produit</th>
      <th align="right" style="padding:0 0 8px;border-bottom:2px solid #392800;font-size:13px;font-weight:700;color:#392800;text-transform:uppercase;letter-spacing:0.04em;">Prix</th>
    </tr>
    ${productRows}
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border-collapse:collapse;">
    <tr>
      <td style="padding:8px 0;font-size:14px;color:#6b7280;">Sous-total</td>
      <td align="right" style="padding:8px 0;font-size:14px;color:#374151;">${esc(formatInvoiceMoney(linesSubtotal, currency))}</td>
    </tr>
    ${shippingRow}
    ${tipRow}
    ${taxRow}
    ${discountRow}
    <tr>
      <td style="padding:10px 0 4px;font-size:14px;color:#6b7280;">Mode de paiement</td>
      <td align="right" style="padding:10px 0 4px;font-size:14px;color:#374151;">${esc(paymentLabel)}</td>
    </tr>
    <tr>
      <td style="padding:12px 0 0;border-top:2px solid #392800;font-size:16px;font-weight:700;color:#392800;">Total</td>
      <td align="right" style="padding:12px 0 0;border-top:2px solid #392800;font-size:16px;font-weight:700;color:#392800;">${esc(formatInvoiceMoney(total, currency))}</td>
    </tr>
  </table>
</div>`.trim();
}
