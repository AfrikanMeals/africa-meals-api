import { AdminOpsReportPeriodEnum } from '@schemas/admin-ops-report-settings.schema';
import {
  resolveCompletedOpsReportPeriod,
  shouldSendOpsReportNow,
} from './admin-ops-report-period.util';

describe('admin-ops-report-period.util', () => {
  it('résout une période hebdomadaire complète', () => {
    const bounds = resolveCompletedOpsReportPeriod(
      AdminOpsReportPeriodEnum.WEEKLY,
      'America/Toronto',
      new Date('2026-06-09T12:00:00.000Z'),
    );
    expect(bounds.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bounds.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bounds.periodKey.startsWith('weekly:')).toBe(true);
  });

  it('n’envoie pas deux fois la même periodKey', () => {
    const ref = new Date('2026-06-02T14:00:00.000Z');
    const bounds = resolveCompletedOpsReportPeriod(
      AdminOpsReportPeriodEnum.DAILY,
      'UTC',
      ref,
    );
    const first = shouldSendOpsReportNow({
      enabled: true,
      period: AdminOpsReportPeriodEnum.DAILY,
      timezone: 'UTC',
      sendHourLocal: 8,
      lastSentPeriodKey: null,
      reference: ref,
    });
    expect(first.send).toBe(true);
    const second = shouldSendOpsReportNow({
      enabled: true,
      period: AdminOpsReportPeriodEnum.DAILY,
      timezone: 'UTC',
      sendHourLocal: 8,
      lastSentPeriodKey: bounds.periodKey,
      reference: ref,
    });
    expect(second.send).toBe(false);
  });
});
