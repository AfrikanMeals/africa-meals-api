import {
  emailDivider,
  emailMutedParagraph,
  emailParagraph,
  emailPrimaryButton,
} from '@modules/mailer/email-layout';
import { escapeEmailHtml } from '@modules/mailer/email-brand.util';
const CAMPAIGN_ITEM_PRODUCT = 'PRODUCT';
const CAMPAIGN_ITEM_DRINK = 'DRINK';

export const AD_NOTIFICATION_ITEMS_FCM_KEY = 'campaignItems';
export const MAX_AD_NOTIFICATION_ITEMS = 12;

export type AdNotificationItemPayload = {
  itemType: 'PRODUCT' | 'DRINK';
  productId: string | null;
  drinkId: string | null;
  title: string;
  imageUrl: string | null;
  priceCad: number;
};

export function mapPopulatedCampaignItems(
  rawItems: unknown[],
): AdNotificationItemPayload[] {
  if (!Array.isArray(rawItems)) return [];
  const out: AdNotificationItemPayload[] = [];
  for (const row of rawItems) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const itemType = String(item.itemType ?? '')
      .trim()
      .toUpperCase();
    if (itemType === CAMPAIGN_ITEM_PRODUCT) {
      const product = (item.product ?? {}) as Record<string, unknown>;
      const productId = product._id ? String(product._id) : null;
      if (!productId) continue;
      out.push({
        itemType: 'PRODUCT',
        productId,
        drinkId: null,
        title: String(product.title ?? 'Produit').trim() || 'Produit',
        imageUrl: product.profileImage
          ? String(product.profileImage).trim()
          : null,
        priceCad: Number(product.price ?? 0),
      });
    } else if (itemType === CAMPAIGN_ITEM_DRINK) {
      const drink = (item.drink ?? {}) as Record<string, unknown>;
      const drinkId = drink._id ? String(drink._id) : null;
      if (!drinkId) continue;
      out.push({
        itemType: 'DRINK',
        productId: null,
        drinkId,
        title: String(drink.name ?? 'Boisson').trim() || 'Boisson',
        imageUrl: drink.imageUrl ? String(drink.imageUrl).trim() : null,
        priceCad: Number(drink.priceCad ?? 0),
      });
    }
    if (out.length >= MAX_AD_NOTIFICATION_ITEMS) break;
  }
  return out;
}

export function mapBannerToNotificationItems(
  banner: Record<string, unknown>,
): AdNotificationItemPayload[] {
  const title = String(banner.title ?? 'Offre').trim() || 'Offre';
  const imageUrl = banner.imageUrl
    ? String(banner.imageUrl).trim()
    : null;
  const product = (banner.product ?? {}) as Record<string, unknown>;
  const productId = product._id ? String(product._id) : null;
  if (productId) {
    return [
      {
        itemType: 'PRODUCT',
        productId,
        drinkId: null,
        title: String(product.title ?? title).trim() || title,
        imageUrl: product.profileImage
          ? String(product.profileImage).trim()
          : imageUrl,
        priceCad: Number(product.price ?? 0),
      },
    ];
  }
  if (!imageUrl && !title) return [];
  return [
    {
      itemType: 'PRODUCT',
      productId: null,
      drinkId: null,
      title,
      imageUrl,
      priceCad: 0,
    },
  ];
}

export function campaignItemsToFcmValue(
  items: AdNotificationItemPayload[],
): string | undefined {
  if (!items.length) return undefined;
  const compact = items.map((it) => ({
    t: it.itemType,
    pid: it.productId,
    did: it.drinkId,
    n: it.title.slice(0, 80),
    img: it.imageUrl?.slice(0, 512) ?? '',
    p: Math.round(it.priceCad * 100) / 100,
  }));
  return JSON.stringify(compact);
}

/** Parse la valeur FCM compacte ou le JSON complet (rétrocompat). */
export function parseCampaignItemsFromFcmValue(
  raw: string | undefined,
): AdNotificationItemPayload[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: AdNotificationItemPayload[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      if ('itemType' in o || 'title' in o) {
        const itemType = String(o.itemType ?? 'PRODUCT')
          .trim()
          .toUpperCase() as 'PRODUCT' | 'DRINK';
        out.push({
          itemType: itemType === 'DRINK' ? 'DRINK' : 'PRODUCT',
          productId: o.productId ? String(o.productId) : null,
          drinkId: o.drinkId ? String(o.drinkId) : null,
          title: String(o.title ?? '').trim() || 'Article',
          imageUrl: o.imageUrl ? String(o.imageUrl) : null,
          priceCad: Number(o.priceCad ?? 0),
        });
      } else {
        const itemType = String(o.t ?? 'PRODUCT')
          .trim()
          .toUpperCase() as 'PRODUCT' | 'DRINK';
        out.push({
          itemType: itemType === 'DRINK' ? 'DRINK' : 'PRODUCT',
          productId: o.pid ? String(o.pid) : null,
          drinkId: o.did ? String(o.did) : null,
          title: String(o.n ?? '').trim() || 'Article',
          imageUrl: o.img ? String(o.img) : null,
          priceCad: Number(o.p ?? 0),
        });
      }
      if (out.length >= MAX_AD_NOTIFICATION_ITEMS) break;
    }
    return out;
  } catch {
    return [];
  }
}

function formatPriceCadEmail(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return '';
  return `${price.toFixed(2)}&nbsp;$`;
}

export function buildAdNotificationEmailBodyHtml(args: {
  recipientName: string;
  storeName: string;
  title: string;
  body: string;
  webUrl: string;
  items: AdNotificationItemPayload[];
}): string {
  const greeting = escapeEmailHtml(args.recipientName);
  const store = escapeEmailHtml(args.storeName);
  const headline = escapeEmailHtml(args.title);
  const intro = escapeEmailHtml(args.body);

  const parts: string[] = [
    emailParagraph(`Bonjour ${greeting},`),
    emailParagraph(`<strong>${store}</strong> — ${headline}`),
    emailParagraph(intro),
  ];

  if (args.items.length) {
    parts.push(emailDivider());
    parts.push(
      emailMutedParagraph(
        args.items.length > 1
          ? 'Articles de la campagne :'
          : 'Article mis en avant :',
      ),
    );
    parts.push(buildAdNotificationItemsEmailList(args.items));
  }

  parts.push(emailPrimaryButton("Voir l'offre", args.webUrl));
  return parts.join('\n');
}

function buildAdNotificationItemsEmailList(
  items: AdNotificationItemPayload[],
): string {
  const rows = items
    .map((it) => {
      const safeTitle = escapeEmailHtml(it.title);
      const price = formatPriceCadEmail(it.priceCad);
      const priceCell = price
        ? `<span style="font-size:14px;font-weight:700;color:#aa6900;">${price}</span>`
        : '';
      const img = it.imageUrl?.trim();
      const imgCell = img
        ? `<td width="72" valign="top" style="padding:0 14px 12px 0;">
        <img src="${img.replace(/"/g, '&quot;')}" alt="" width="64" height="64"
          style="display:block;width:64px;height:64px;border-radius:10px;object-fit:cover;border:1px solid #e8e0d4;" />
      </td>`
        : `<td width="16" style="padding:0;"></td>`;
      const typeLabel =
        it.itemType === 'DRINK' ? 'Boisson' : 'Plat';
      return `
<tr>
  ${imgCell}
  <td valign="top" style="padding:0 0 14px 0;border-bottom:1px solid #f0ebe3;">
    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;">${escapeEmailHtml(typeLabel)}</p>
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#392800;">${safeTitle}</p>
    ${priceCell}
  </td>
</tr>`.trim();
    })
    .join('\n');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;">${rows}</table>`;
}

export function buildAdNotificationEmailText(args: {
  recipientName: string;
  storeName: string;
  title: string;
  body: string;
  webUrl: string;
  items: AdNotificationItemPayload[];
}): string {
  const lines = [
    `Bonjour ${args.recipientName},`,
    '',
    `${args.storeName} — ${args.title}`,
    args.body,
    '',
  ];
  if (args.items.length) {
    lines.push('Articles :');
    for (const it of args.items) {
      const price =
        it.priceCad > 0 ? ` — ${it.priceCad.toFixed(2)} $` : '';
      lines.push(`- ${it.title}${price}`);
    }
    lines.push('');
  }
  lines.push(`Voir l'offre : ${args.webUrl}`);
  return lines.join('\n');
}
