/** Modules sur lesquels une règle de taxe peut s’appliquer. */
export const REGION_TAX_MODULES = [
  'order',
  'payout',
  'subscription',
  'refund',
] as const;

export type RegionTaxModule = (typeof REGION_TAX_MODULES)[number];

export const REGION_TAX_FEE_TYPES = ['percent', 'fixed'] as const;

export type RegionTaxFeeType = (typeof REGION_TAX_FEE_TYPES)[number];

export type RegionTaxRule = {
  name: string;
  description?: string;
  feeType: RegionTaxFeeType;
  feeValue: number;
  modules: RegionTaxModule[];
};

export type RegionTaxLineResult = {
  name: string;
  description?: string;
  feeType: RegionTaxFeeType;
  feeValue: number;
  modules: RegionTaxModule[];
  amount: number;
};

export type RegionTaxBreakdown = {
  countryCode: string;
  module: RegionTaxModule;
  baseAmount: number;
  lines: RegionTaxLineResult[];
  taxTotal: number;
};
