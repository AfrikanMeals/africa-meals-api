export type GoogleMerchantExportFormat = 'csv' | 'txt' | 'xlsx' | 'json' | 'xml';

/** Internal model aligned with Google Merchant Center attribute names (camelCase). */
export type GoogleMerchantFeedItem = {
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink?: string;
  additionalImageLink?: string;
  mobileLink?: string;
  availability: string;
  price: string;
  salePrice?: string;
  condition: string;
  brand: string;
  identifierExists: string;
  mpn: string;
  googleProductCategory: string;
  productType: string;
  itemGroupId?: string;
  itemGroupTitle?: string;
  size?: string;
  customLabel0?: string;
  customLabel1?: string;
};

export type GoogleMerchantExportResult = {
  body: Buffer | string;
  contentType: string;
  filename: string;
};

export type GoogleMerchantAdminMeta = {
  feedUrl: string;
  storeFeedUrlTemplate: string;
  recommendedFormat: GoogleMerchantExportFormat;
  supportedFormats: GoogleMerchantExportFormat[];
  publicWebUrl: string;
  basicAuthConfigured: boolean;
  basicAuthUser: string | null;
  activeStoreCount: number;
  activeProductCount: number;
  sampleProductLink: string | null;
  sampleStoreLink: string | null;
};
