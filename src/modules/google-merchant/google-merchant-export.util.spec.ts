import {
  buildGoogleMerchantCsv,
  buildGoogleMerchantJson,
  buildGoogleMerchantTxt,
  buildGoogleMerchantXml,
  feedItemToGoogleRecord,
  formatGoogleMerchantPrice,
  normalizeGoogleMerchantFormat,
  resolveGoogleMerchantPricePair,
} from './google-merchant-export.util';
import { GoogleMerchantFeedItem } from './google-merchant.types';

const sampleItems: GoogleMerchantFeedItem[] = [
  {
    id: 'prod123',
    title: 'Pixel 6a',
    description: 'Un téléphone Google plus abordable.',
    link: 'https://wise-eat.com/stores/store1/products/prod123',
    mobileLink: 'https://wise-eat.com/stores/store1/products/prod123',
    imageLink: 'https://cdn.example.com/pixel.jpg',
    additionalImageLink: 'https://cdn.example.com/pixel-2.jpg',
    availability: 'in_stock',
    price: '449.00 CAD',
    salePrice: '399.00 CAD',
    condition: 'new',
    brand: 'Demo Store',
    identifierExists: 'no',
    mpn: 'prod123',
    googleProductCategory: '5814',
    productType: 'Demo Store > Plats',
    customLabel0: 'store1',
    customLabel1: 'Demo Store',
  },
];

describe('google-merchant-export.util', () => {
  it('normalizes supported formats', () => {
    expect(normalizeGoogleMerchantFormat('CSV')).toBe('csv');
    expect(normalizeGoogleMerchantFormat(' xml ')).toBe('xml');
    expect(normalizeGoogleMerchantFormat('txt')).toBe('txt');
    expect(normalizeGoogleMerchantFormat('tsv')).toBe('txt');
    expect(normalizeGoogleMerchantFormat('xls')).toBe('txt');
    expect(normalizeGoogleMerchantFormat('pdf')).toBeNull();
  });

  it('formats price for Google Merchant', () => {
    expect(formatGoogleMerchantPrice(449, 'cad')).toBe('449.00 CAD');
  });

  it('maps list and sale price per Google spec', () => {
    expect(resolveGoogleMerchantPricePair(10, 8, 'CAD')).toEqual({
      price: '10.00 CAD',
      salePrice: '8.00 CAD',
    });
    expect(resolveGoogleMerchantPricePair(10, 0, 'CAD')).toEqual({
      price: '10.00 CAD',
    });
  });

  it('builds CSV with Google Merchant attribute headers', () => {
    const csv = buildGoogleMerchantCsv(sampleItems);
    expect(csv).toContain('google_product_category');
    expect(csv).toContain('identifier_exists');
    expect(csv).toContain('sale_price');
    expect(csv).toContain('5814');
  });

  it('builds tab-delimited TXT for Google Merchant scheduled feeds', () => {
    const txt = buildGoogleMerchantTxt(sampleItems);
    const [header, row] = txt.split('\n');
    expect(header?.split('\t')[0]).toBe('id');
    expect(header).toContain('google_product_category');
    expect(row).toContain('prod123');
    expect(row).toContain('5814');
    expect(txt).not.toMatch(/\t.*\t.*,/);
  });

  it('builds JSON with snake_case Google attribute names', () => {
    const json = JSON.parse(buildGoogleMerchantJson(sampleItems)) as Array<
      Record<string, string>
    >;
    expect(json[0].image_link).toBe('https://cdn.example.com/pixel.jpg');
    expect(json[0].google_product_category).toBe('5814');
    expect(json[0].identifier_exists).toBe('no');
  });

  it('maps feed item to Google record', () => {
    const record = feedItemToGoogleRecord(sampleItems[0]);
    expect(record.custom_label_0).toBe('store1');
    expect(record.mobile_link).toBe(sampleItems[0].link);
  });

  it('builds RSS XML feed with extended attributes', () => {
    const xml = buildGoogleMerchantXml(sampleItems, {
      title: 'Demo Store',
      link: 'https://wise-eat.com/stores/demo',
      description: 'Demo feed',
    });
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain('<g:brand>Demo Store</g:brand>');
    expect(xml).toContain('<g:sale_price>399.00 CAD</g:sale_price>');
  });
});
