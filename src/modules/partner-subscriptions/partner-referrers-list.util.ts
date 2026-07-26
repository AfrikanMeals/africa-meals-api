/**
 * Agrégation réseau Partner : filleuls par rôle + gains par axe.
 * Testable sans Mongo (portail admin Référents).
 */

import {
  computePartnerEarningListTotals,
  mapPartnerEarningToListItem,
  type PartnerEarningListItemDto,
  type PartnerEarningListLean,
  type PartnerEarningListTotalsDto,
} from './partner-earning-list.util';

export type PartnerReferrerTab = 'customer' | 'vendor' | 'courier';

export type PartnerReferrerUserLean = {
  _id?: { toString(): string } | string;
  full_name?: string;
  fullName?: string;
  email?: string;
  type?: string;
  referredByPartnerCode?: string;
  createdAt?: Date | string;
};

export type PartnerReferrerRowDto = {
  id: string;
  fullName: string;
  email: string;
  type: string;
  /** Date inscription (proxy date de parrainage). */
  referredAt: string | null;
  referralCode: string;
};

export type PartnerReferrersTabDto = {
  tab: PartnerReferrerTab;
  axis: string;
  referrers: PartnerReferrerRowDto[];
  earnings: PartnerEarningListItemDto[];
  totals: PartnerEarningListTotalsDto;
};

export type PartnerReferrersBundleDto = {
  customer: PartnerReferrersTabDto;
  vendor: PartnerReferrersTabDto;
  courier: PartnerReferrersTabDto;
};

const TAB_AXIS: Record<PartnerReferrerTab, string> = {
  customer: 'customer_order',
  vendor: 'vendor_sales',
  courier: 'courier_gains',
};

/** Mappe le type user → onglet Référents (autres types ignorés). */
export function partnerUserTypeToReferrerTab(
  type: string | null | undefined,
): PartnerReferrerTab | null {
  const t = String(type ?? '')
    .trim()
    .toUpperCase();
  if (t === 'USER') return 'customer';
  if (t === 'VENDOR') return 'vendor';
  if (t === 'DELIVERY') return 'courier';
  return null;
}

export function partnerReferrerTabAxis(tab: PartnerReferrerTab): string {
  return TAB_AXIS[tab];
}

function dateIso(raw: unknown): string | null {
  if (raw == null) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function idOf(raw: PartnerReferrerUserLean['_id']): string {
  if (raw == null) return '';
  return typeof raw === 'string' ? raw : String(raw.toString());
}

/** Sérialise un filleul (PII minimale pour le Partner titulaire). */
export function mapPartnerReferrerRow(
  user: PartnerReferrerUserLean,
): PartnerReferrerRowDto | null {
  const id = idOf(user._id);
  if (!id) return null;
  const fullName = String(user.fullName ?? user.full_name ?? '')
    .trim();
  return {
    id,
    fullName: fullName || '—',
    email: String(user.email ?? '')
      .trim()
      .toLowerCase(),
    type: String(user.type ?? '')
      .trim()
      .toUpperCase(),
    referredAt: dateIso(user.createdAt),
    referralCode: String(user.referredByPartnerCode ?? '')
      .trim()
      .toUpperCase(),
  };
}

/**
 * Construit les 3 onglets : filleuls filtrés par type + ledger filtré par axe.
 */
export function buildPartnerReferrersBundle(args: {
  users: PartnerReferrerUserLean[];
  earnings: PartnerEarningListLean[];
}): PartnerReferrersBundleDto {
  const buckets: Record<PartnerReferrerTab, PartnerReferrerRowDto[]> = {
    customer: [],
    vendor: [],
    courier: [],
  };
  for (const u of args.users) {
    const tab = partnerUserTypeToReferrerTab(u.type);
    if (!tab) continue;
    const row = mapPartnerReferrerRow(u);
    if (row) buckets[tab].push(row);
  }
  // Récence d’inscription d’abord.
  for (const tab of Object.keys(buckets) as PartnerReferrerTab[]) {
    buckets[tab].sort((a, b) => {
      const ta = a.referredAt ? Date.parse(a.referredAt) : 0;
      const tb = b.referredAt ? Date.parse(b.referredAt) : 0;
      return tb - ta;
    });
  }

  const allEarnings = args.earnings.map(mapPartnerEarningToListItem);
  const byAxis = (axis: string) =>
    allEarnings.filter((e) => e.axis === axis);

  const makeTab = (tab: PartnerReferrerTab): PartnerReferrersTabDto => {
    const axis = partnerReferrerTabAxis(tab);
    const earnings = byAxis(axis);
    return {
      tab,
      axis,
      referrers: buckets[tab],
      earnings,
      totals: computePartnerEarningListTotals(earnings),
    };
  };

  return {
    customer: makeTab('customer'),
    vendor: makeTab('vendor'),
    courier: makeTab('courier'),
  };
}
