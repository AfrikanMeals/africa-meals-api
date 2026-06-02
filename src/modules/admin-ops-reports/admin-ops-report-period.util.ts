import { AdminOpsReportPeriodEnum } from '@schemas/admin-ops-report-settings.schema';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

export type OpsReportPeriodBounds = {
  period: AdminOpsReportPeriodEnum;
  timezone: string;
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  periodKey: string;
  labelFr: string;
};

/** Dernière période complète avant `reference` (fuseau admin). */
export function resolveCompletedOpsReportPeriod(
  period: AdminOpsReportPeriodEnum,
  tz: string,
  reference: Date = new Date(),
): OpsReportPeriodBounds {
  const now = dayjs(reference).tz(tz);

  if (period === AdminOpsReportPeriodEnum.DAILY) {
    const day = now.subtract(1, 'day').startOf('day');
    const from = day.format('YYYY-MM-DD');
    const prior = day.subtract(1, 'day');
    return {
      period,
      timezone: tz,
      from,
      to: from,
      priorFrom: prior.format('YYYY-MM-DD'),
      priorTo: prior.format('YYYY-MM-DD'),
      periodKey: `daily:${from}`,
      labelFr: `Journée ${from}`,
    };
  }

  if (period === AdminOpsReportPeriodEnum.WEEKLY) {
    const weekEnd = now.subtract(1, 'week').endOf('isoWeek');
    const weekStart = weekEnd.startOf('isoWeek');
    const priorWeekEnd = weekStart.subtract(1, 'day');
    const priorWeekStart = priorWeekEnd.startOf('isoWeek');
    const from = weekStart.format('YYYY-MM-DD');
    const to = weekEnd.format('YYYY-MM-DD');
    return {
      period,
      timezone: tz,
      from,
      to,
      priorFrom: priorWeekStart.format('YYYY-MM-DD'),
      priorTo: priorWeekEnd.format('YYYY-MM-DD'),
      periodKey: `weekly:${from}:${to}`,
      labelFr: `Semaine ${from} → ${to}`,
    };
  }

  const month = now.subtract(1, 'month');
  const from = month.startOf('month').format('YYYY-MM-DD');
  const to = month.endOf('month').format('YYYY-MM-DD');
  const priorMonth = month.subtract(1, 'month');
  return {
    period,
    timezone: tz,
    from,
    to,
    priorFrom: priorMonth.startOf('month').format('YYYY-MM-DD'),
    priorTo: priorMonth.endOf('month').format('YYYY-MM-DD'),
    periodKey: `monthly:${month.format('YYYY-MM')}`,
    labelFr: `Mois ${month.format('MMMM YYYY')}`,
  };
}

export function shouldSendOpsReportNow(input: {
  enabled: boolean;
  period: AdminOpsReportPeriodEnum;
  timezone: string;
  sendHourLocal: number;
  lastSentPeriodKey: string | null;
  reference?: Date;
}): { send: boolean; bounds: OpsReportPeriodBounds | null } {
  if (!input.enabled) return { send: false, bounds: null };
  const tz = input.timezone?.trim() || 'America/Toronto';
  const hour = Math.max(0, Math.min(23, Math.trunc(input.sendHourLocal ?? 8)));
  const now = dayjs(input.reference ?? new Date()).tz(tz);
  if (now.hour() < hour) return { send: false, bounds: null };

  const bounds = resolveCompletedOpsReportPeriod(
    input.period,
    tz,
    input.reference ?? new Date(),
  );
  if (input.lastSentPeriodKey === bounds.periodKey) {
    return { send: false, bounds };
  }
  return { send: true, bounds };
}
