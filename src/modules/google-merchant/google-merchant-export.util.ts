import ExcelJS from 'exceljs';
import {
  GoogleMerchantExportFormat,
  GoogleMerchantExportResult,
  GoogleMerchantFeedItem,
} from './google-merchant.types';

type FeedFieldDef = {
  key: keyof GoogleMerchantFeedItem;
  label: string;
};

/** Column order follows Google Merchant product data specification groupings. */
export const GOOGLE_MERCHANT_FEED_FIELDS: FeedFieldDef[] = [
  { key: 'id', label: 'id' },
  { key: 'title', label: 'title' },
  { key: 'description', label: 'description' },
  { key: 'link', label: 'link' },
  { key: 'mobileLink', label: 'mobile_link' },
  { key: 'imageLink', label: 'image_link' },
  { key: 'additionalImageLink', label: 'additional_image_link' },
  { key: 'availability', label: 'availability' },
  { key: 'price', label: 'price' },
  { key: 'salePrice', label: 'sale_price' },
  { key: 'condition', label: 'condition' },
  { key: 'brand', label: 'brand' },
  { key: 'identifierExists', label: 'identifier_exists' },
  { key: 'mpn', label: 'mpn' },
  { key: 'googleProductCategory', label: 'google_product_category' },
  { key: 'productType', label: 'product_type' },
  { key: 'itemGroupId', label: 'item_group_id' },
  { key: 'itemGroupTitle', label: 'item_group_title' },
  { key: 'size', label: 'size' },
  { key: 'customLabel0', label: 'custom_label_0' },
  { key: 'customLabel1', label: 'custom_label_1' },
];

export function normalizeGoogleMerchantFormat(
  raw: string | undefined,
): GoogleMerchantExportFormat | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  // GMC rejects legacy Excel (.xls) — serve tab-delimited .txt instead.
  if (value === 'xls') return 'txt';
  if (value === 'tsv') return 'txt';
  if (
    value === 'csv' ||
    value === 'txt' ||
    value === 'xlsx' ||
    value === 'json' ||
    value === 'xml'
  ) {
    return value;
  }
  return null;
}

export function formatGoogleMerchantPrice(
  amount: number,
  currency: string,
): string {
  const safeAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  const safeCurrency = currency.trim().toUpperCase() || 'CAD';
  return `${safeAmount.toFixed(2)} ${safeCurrency}`;
}

export type GoogleMerchantPricePair = {
  price: string;
  salePrice?: string;
};

/** Google expects list price in `price` and discounted price in `sale_price`. */
export function resolveGoogleMerchantPricePair(
  listPrice: number,
  discountPrice: number,
  currency: string,
): GoogleMerchantPricePair {
  const base = listPrice > 0 ? listPrice : discountPrice;
  const hasSale =
    discountPrice > 0 && listPrice > 0 && discountPrice < listPrice;
  if (hasSale) {
    return {
      price: formatGoogleMerchantPrice(listPrice, currency),
      salePrice: formatGoogleMerchantPrice(discountPrice, currency),
    };
  }
  return { price: formatGoogleMerchantPrice(base, currency) };
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeTxtCell(value: string): string {
  if (/[\t\n\r"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function feedItemToRow(item: GoogleMerchantFeedItem): string[] {
  return GOOGLE_MERCHANT_FEED_FIELDS.map(({ key }) => item[key] ?? '');
}

export function feedItemToGoogleRecord(
  item: GoogleMerchantFeedItem,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { key, label } of GOOGLE_MERCHANT_FEED_FIELDS) {
    const value = item[key]?.trim();
    if (value) record[label] = value;
  }
  return record;
}

export function buildGoogleMerchantCsv(items: GoogleMerchantFeedItem[]): string {
  const headerLine = GOOGLE_MERCHANT_FEED_FIELDS.map(({ label }) => label).join(
    ',',
  );
  const lines = items.map((item) =>
    feedItemToRow(item).map((cell) => escapeCsvCell(cell)).join(','),
  );
  return [headerLine, ...lines].join('\n');
}

/** Tab-delimited plain text — format accepted by Google Merchant Center scheduled feeds. */
export function buildGoogleMerchantTxt(items: GoogleMerchantFeedItem[]): string {
  const headerLine = GOOGLE_MERCHANT_FEED_FIELDS.map(({ label }) => label).join(
    '\t',
  );
  const lines = items.map((item) =>
    feedItemToRow(item).map((cell) => escapeTxtCell(cell)).join('\t'),
  );
  return [headerLine, ...lines].join('\n');
}

export async function buildGoogleMerchantXlsx(
  items: GoogleMerchantFeedItem[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Wise Eat';
  workbook.created = new Date();
  const ws = workbook.addWorksheet('Products');
  ws.addRow(GOOGLE_MERCHANT_FEED_FIELDS.map(({ label }) => label));
  ws.getRow(1).font = { bold: true };
  for (const item of items) {
    ws.addRow(feedItemToRow(item));
  }
  ws.columns.forEach((col) => {
    let max = 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > max) max = Math.min(len + 2, 64);
    });
    col.width = max;
  });
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildGoogleMerchantJson(items: GoogleMerchantFeedItem[]): string {
  const payload = items.map((item) => feedItemToGoogleRecord(item));
  return JSON.stringify(payload, null, 2);
}

const XML_FIELD_MAP: Array<{
  key: keyof GoogleMerchantFeedItem;
  tag: string;
}> = GOOGLE_MERCHANT_FEED_FIELDS.map(({ key, label }) => ({
  key,
  tag: label,
}));

export function buildGoogleMerchantXml(
  items: GoogleMerchantFeedItem[],
  channel: { title: string; link: string; description: string },
): string {
  const itemXml = items
    .map((item) => {
      const fields = XML_FIELD_MAP.map(({ key, tag }) => {
        const value = item[key]?.trim();
        if (!value) return '';
        return `<g:${tag}>${escapeXml(value)}</g:${tag}>`;
      })
        .filter(Boolean)
        .join('');
      return `<item>${fields}</item>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">` +
    `<channel>` +
    `<title>${escapeXml(channel.title)}</title>` +
    `<link>${escapeXml(channel.link)}</link>` +
    `<description>${escapeXml(channel.description)}</description>` +
    itemXml +
    `</channel></rss>`;
}

export type GoogleMerchantExportMeta = {
  filenameSlug: string;
  channel: { title: string; link: string; description: string };
};

export async function buildGoogleMerchantExport(
  format: GoogleMerchantExportFormat,
  items: GoogleMerchantFeedItem[],
  meta: GoogleMerchantExportMeta,
): Promise<GoogleMerchantExportResult> {
  const safeSlug = meta.filenameSlug.replace(/[^a-zA-Z0-9_-]+/g, '_');

  switch (format) {
    case 'csv':
      return {
        body: buildGoogleMerchantCsv(items),
        contentType: 'text/csv; charset=utf-8',
        filename: `google-merchant-${safeSlug}.csv`,
      };
    case 'txt':
      return {
        body: buildGoogleMerchantTxt(items),
        contentType: 'text/plain; charset=utf-8',
        filename: `google-merchant-${safeSlug}.txt`,
      };
    case 'xlsx':
      return {
        body: await buildGoogleMerchantXlsx(items),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `google-merchant-${safeSlug}.xlsx`,
      };
    case 'json':
      return {
        body: buildGoogleMerchantJson(items),
        contentType: 'application/json; charset=utf-8',
        filename: `google-merchant-${safeSlug}.json`,
      };
    case 'xml':
      return {
        body: buildGoogleMerchantXml(items, meta.channel),
        contentType: 'application/xml; charset=utf-8',
        filename: `google-merchant-${safeSlug}.xml`,
      };
  }
}
