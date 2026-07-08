import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  REGION_TAX_FEE_TYPES,
  REGION_TAX_MODULES,
  type RegionTaxBreakdown,
  type RegionTaxFeeType,
  type RegionTaxLineResult,
  type RegionTaxModule,
  type RegionTaxRule,
} from './region-tax.constants';

export function normalizeRegionTaxRules(raw: unknown): RegionTaxRule[] {
  if (!Array.isArray(raw)) return [];
  const out: RegionTaxRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? o.label ?? '').trim();
    if (!name) continue;
    const feeTypeRaw = String(o.feeType ?? o.fee_type ?? 'percent')
      .trim()
      .toLowerCase();
    const feeType = REGION_TAX_FEE_TYPES.includes(
      feeTypeRaw as RegionTaxFeeType,
    )
      ? (feeTypeRaw as RegionTaxFeeType)
      : 'percent';
    const feeValue = Math.max(0, Number(o.feeValue ?? o.fee_value ?? 0) || 0);
    const modulesRaw = o.modules ?? o.appliedModules ?? o.applied_modules;
    const modules: RegionTaxModule[] = [];
    if (Array.isArray(modulesRaw)) {
      for (const m of modulesRaw) {
        const key = String(m ?? '')
          .trim()
          .toLowerCase();
        if (REGION_TAX_MODULES.includes(key as RegionTaxModule)) {
          modules.push(key as RegionTaxModule);
        }
      }
    }
    if (!modules.length) continue;
    const description = String(o.description ?? o.tooltip ?? '').trim();
    out.push({
      name: name.slice(0, 120),
      description: description ? description.slice(0, 500) : undefined,
      feeType,
      feeValue,
      modules: [...new Set(modules)],
    });
  }
  return out;
}

export function roundTaxMoney(amount: number): number {
  return Math.round(amount * 100 + Number.EPSILON) / 100;
}

export function computeRegionTaxBreakdown(args: {
  countryCode: string;
  baseAmount: number;
  module: RegionTaxModule;
  rules: RegionTaxRule[];
}): RegionTaxBreakdown {
  const countryCode = String(args.countryCode ?? '')
    .trim()
    .toUpperCase();
  const baseAmount = Math.max(0, Number(args.baseAmount) || 0);
  const module = args.module;
  if (!REGION_TAX_MODULES.includes(module)) {
    throw new BadRequestException('invalid_tax_module');
  }
  const lines: RegionTaxLineResult[] = [];
  for (const rule of args.rules) {
    if (!rule.modules.includes(module)) continue;
    let amount = 0;
    if (rule.feeType === 'percent') {
      amount = roundTaxMoney((baseAmount * rule.feeValue) / 100);
    } else {
      amount = roundTaxMoney(rule.feeValue);
    }
    if (amount <= 0) continue;
    lines.push({
      name: rule.name,
      description: rule.description,
      feeType: rule.feeType,
      feeValue: rule.feeValue,
      modules: [...rule.modules],
      amount,
    });
  }
  const taxTotal = roundTaxMoney(
    lines.reduce((acc, l) => acc + l.amount, 0),
  );
  return {
    countryCode,
    module,
    baseAmount,
    lines,
    taxTotal,
  };
}

/** Résout le code pays pour les taxes (0 % si absent de la config active). */
export function resolveTaxCountryCode(
  candidates: Array<string | null | undefined>,
): string {
  for (const c of candidates) {
    const code = String(c ?? '')
      .trim()
      .toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return '';
}

/** Pays ISO enregistré sur la boutique (`stores.region`) — taxes / devise. */
export function countryCodeFromStoreRegion(store: unknown): string {
  if (!store || typeof store !== 'object') return '';
  const cc = String((store as Record<string, unknown>).region ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : '';
}

/** Pays ISO du restaurant (`address.countryCode` peuplé) — adresse physique. */
export function countryCodeFromStoreAddress(store: unknown): string {
  if (!store || typeof store !== 'object') return '';
  const addr = (store as Record<string, unknown>).address;
  if (!addr || typeof addr !== 'object' || Array.isArray(addr)) return '';
  const cc = String(
    (addr as Record<string, unknown>).countryCode ??
      (addr as Record<string, unknown>).country_code ??
      '',
  )
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : '';
}

/** Devises → pays ISO lorsqu’il n’y a qu’un seul candidat (ex. CAD → CA). */
const UNIQUE_CURRENCY_COUNTRY: Record<string, string> = {
  CAD: 'CA',
  USD: 'US',
  EUR: 'FR',
  CHF: 'CH',
  MAD: 'MA',
  CDF: 'CD',
};

function countryCodeFromStorePhone(store: Record<string, unknown>): string {
  const raw = String(store.phoneNumber ?? store.phone_number ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = parsePhoneNumberFromString(raw);
    const cc = parsed?.country?.trim().toUpperCase() ?? '';
    return /^[A-Z]{2}$/.test(cc) ? cc : '';
  } catch {
    return '';
  }
}

function countryCodeFromStoreCurrency(store: Record<string, unknown>): string {
  const cur = String(store.currency ?? '').trim().toUpperCase();
  return UNIQUE_CURRENCY_COUNTRY[cur] ?? '';
}

/**
 * Pays fiscal d’une boutique : `stores.region` en priorité, repli legacy (téléphone, adresse).
 */
export function resolveStoreTaxCountryCode(store: unknown): string {
  if (!store || typeof store !== 'object') return '';
  const doc = store as Record<string, unknown>;
  const fromRegion = countryCodeFromStoreRegion(store);
  if (fromRegion) return fromRegion;
  const fromPhone = countryCodeFromStorePhone(doc);
  const fromCurrency = countryCodeFromStoreCurrency(doc);
  const fromAddr = countryCodeFromStoreAddress(store);

  if (fromPhone) return fromPhone;
  if (fromAddr) return fromAddr;
  if (fromCurrency) return fromCurrency;
  return '';
}

/** Pays ISO du snapshot adresse livraison figé sur la commande. */
export function countryCodeFromOrderDeliverySnapshot(order: unknown): string {
  if (!order || typeof order !== 'object') return '';
  const doc = order as Record<string, unknown>;
  const snap = doc.deliveryAddressSnapshot ?? doc.delivery_address_snapshot;
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return '';
  const cc = String(
    (snap as Record<string, unknown>).countryCode ??
      (snap as Record<string, unknown>).country_code ??
      '',
  )
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : '';
}

/** Pays ISO de l’adresse client par défaut (commande peuplée `user.addresses`). */
export function countryCodeFromUserDefaultAddress(user: unknown): string {
  if (!user || typeof user !== 'object') return '';
  const list = (user as Record<string, unknown>).addresses;
  if (!Array.isArray(list) || list.length === 0) return '';

  let picked: Record<string, unknown> | null = null;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (row.isDefault === true || row.is_default === true) {
      picked = row;
      break;
    }
  }
  if (!picked && list[0] && typeof list[0] === 'object' && !Array.isArray(list[0])) {
    picked = list[0] as Record<string, unknown>;
  }
  if (!picked) return '';

  const cc = String(picked.countryCode ?? picked.country_code ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : '';
}

/**
 * Région ISO2 d’une commande pour filtrage livreur :
 * boutique (region + replis) → taxes commande → adresse livraison → profil client.
 */
export function resolveOrderOperatingRegionCode(
  order: Record<string, unknown>,
): string {
  const storeObj =
    order.store && typeof order.store === 'object' && !Array.isArray(order.store)
      ? order.store
      : null;
  return resolveTaxCountryCode([
    resolveStoreTaxCountryCode(storeObj),
    typeof order.taxCountryCode === 'string' ? order.taxCountryCode : null,
    countryCodeFromOrderDeliverySnapshot(order),
    countryCodeFromUserDefaultAddress(order.user),
  ]);
}
