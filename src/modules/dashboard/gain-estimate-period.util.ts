import type { GainEstimatePeriodKey } from './gain-estimate.types';

/** Parse query `period` — défaut 30d. */
export function parseGainEstimatePeriod(raw?: string): GainEstimatePeriodKey {
  if (raw === '7d' || raw === '90d') return raw;
  return '30d';
}

/** Nombre de jours calendaires inclus dans la fenêtre. */
export function gainEstimatePeriodDays(period: GainEstimatePeriodKey): number {
  if (period === '7d') return 7;
  if (period === '90d') return 90;
  return 30;
}
