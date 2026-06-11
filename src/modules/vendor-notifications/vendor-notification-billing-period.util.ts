export enum VendorNotificationBillingCyclePeriodEnum {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export const VENDOR_NOTIFICATION_BILLING_CYCLE_PERIODS = [
  VendorNotificationBillingCyclePeriodEnum.DAILY,
  VendorNotificationBillingCyclePeriodEnum.WEEKLY,
  VendorNotificationBillingCyclePeriodEnum.MONTHLY,
] as const;

export function normalizeBillingCyclePeriod(
  raw: unknown,
): VendorNotificationBillingCyclePeriodEnum {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (value === VendorNotificationBillingCyclePeriodEnum.DAILY) {
    return VendorNotificationBillingCyclePeriodEnum.DAILY;
  }
  if (value === VendorNotificationBillingCyclePeriodEnum.WEEKLY) {
    return VendorNotificationBillingCyclePeriodEnum.WEEKLY;
  }
  return VendorNotificationBillingCyclePeriodEnum.MONTHLY;
}

/** Clé de période de facturation (stockée dans `billingMonth`). */
export function billingPeriodKey(
  date: Date,
  period: VendorNotificationBillingCyclePeriodEnum = VendorNotificationBillingCyclePeriodEnum.MONTHLY,
): string {
  const normalized = normalizeBillingCyclePeriod(period);
  if (normalized === VendorNotificationBillingCyclePeriodEnum.DAILY) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (normalized === VendorNotificationBillingCyclePeriodEnum.WEEKLY) {
    return isoWeekKey(date);
  }
  return billingMonthKey(date);
}

export function billingMonthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function previousBillingPeriodKey(
  from = new Date(),
  period: VendorNotificationBillingCyclePeriodEnum = VendorNotificationBillingCyclePeriodEnum.MONTHLY,
): string {
  const normalized = normalizeBillingCyclePeriod(period);
  if (normalized === VendorNotificationBillingCyclePeriodEnum.DAILY) {
    const d = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
    d.setUTCDate(d.getUTCDate() - 1);
    return billingPeriodKey(d, normalized);
  }
  if (normalized === VendorNotificationBillingCyclePeriodEnum.WEEKLY) {
    const d = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
    d.setUTCDate(d.getUTCDate() - 7);
    return billingPeriodKey(d, normalized);
  }
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1),
  );
  return billingPeriodKey(d, normalized);
}

/** @deprecated Utiliser `previousBillingPeriodKey`. */
export function previousBillingMonthKey(from = new Date()): string {
  return previousBillingPeriodKey(
    from,
    VendorNotificationBillingCyclePeriodEnum.MONTHLY,
  );
}

export function shouldClosePreviousBillingPeriod(
  now = new Date(),
  period: VendorNotificationBillingCyclePeriodEnum = VendorNotificationBillingCyclePeriodEnum.MONTHLY,
): boolean {
  const normalized = normalizeBillingCyclePeriod(period);
  if (normalized === VendorNotificationBillingCyclePeriodEnum.DAILY) {
    return true;
  }
  if (normalized === VendorNotificationBillingCyclePeriodEnum.WEEKLY) {
    return now.getUTCDay() === 1;
  }
  return now.getUTCDate() === 1;
}

function isoWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function billingCyclePeriodLabelFr(
  period: VendorNotificationBillingCyclePeriodEnum,
): string {
  switch (normalizeBillingCyclePeriod(period)) {
    case VendorNotificationBillingCyclePeriodEnum.DAILY:
      return 'Quotidienne';
    case VendorNotificationBillingCyclePeriodEnum.WEEKLY:
      return 'Hebdomadaire';
    default:
      return 'Mensuelle';
  }
}

export function currentBillingPeriodFilterValue(
  period: VendorNotificationBillingCyclePeriodEnum,
  now = new Date(),
): string {
  return billingPeriodKey(now, period);
}
