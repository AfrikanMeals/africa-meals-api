import {
  computePartnerPlanFeeAmount,
  normalizePartnerPlanPayoutDelayDays,
  normalizePartnerTrialReminderDays,
  partnerPlanPayoutTimingLabel,
} from './partner-plan-fee.util';

describe('computePartnerPlanFeeAmount', () => {
  it('percent sur base', () => {
    const r = computePartnerPlanFeeAmount(
      { mode: 'percent', fixed: 0, percent: 10 },
      200,
    );
    expect(r.amount).toBe(20);
    expect(r.feeMode).toBe('percent');
  });

  it('fixed ignore la base', () => {
    const r = computePartnerPlanFeeAmount(
      { mode: 'fixed', fixed: 5, percent: 50 },
      200,
    );
    expect(r.amount).toBe(5);
    expect(r.feeMode).toBe('fixed');
  });

  it('fallbackMode prioritaire', () => {
    const r = computePartnerPlanFeeAmount(
      {
        mode: 'percent',
        fixed: 0,
        percent: 99,
        fallbackMode: 'fixed',
        fallbackFixed: 3,
        fallbackPercent: 0,
      },
      100,
    );
    expect(r.amount).toBe(3);
  });

  it('null → 0', () => {
    expect(computePartnerPlanFeeAmount(null, 50).amount).toBe(0);
  });
});

describe('normalizePartnerTrialReminderDays', () => {
  it('filtre hors trial et doublons', () => {
    expect(
      normalizePartnerTrialReminderDays([7, 7, 3, 1, 30], 14),
    ).toEqual([7, 3, 1]);
  });

  it('vide si pas d’essai', () => {
    expect(normalizePartnerTrialReminderDays([7, 3], 0)).toEqual([]);
  });
});

describe('normalizePartnerPlanPayoutDelayDays', () => {
  it('0 = instantané ; clamp 0–30', () => {
    expect(normalizePartnerPlanPayoutDelayDays(0)).toBe(0);
    expect(normalizePartnerPlanPayoutDelayDays(undefined)).toBe(0);
    expect(normalizePartnerPlanPayoutDelayDays(-2)).toBe(0);
    expect(normalizePartnerPlanPayoutDelayDays(7)).toBe(7);
    expect(normalizePartnerPlanPayoutDelayDays(99)).toBe(30);
  });

  it('libellé timing', () => {
    expect(partnerPlanPayoutTimingLabel(0)).toBe('Instantané');
    expect(partnerPlanPayoutTimingLabel(1)).toBe('1 jour');
    expect(partnerPlanPayoutTimingLabel(7)).toBe('7 jours');
  });
});
