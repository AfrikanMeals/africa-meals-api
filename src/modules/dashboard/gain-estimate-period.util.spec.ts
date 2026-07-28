import {
  gainEstimatePeriodDays,
  parseGainEstimatePeriod,
} from './gain-estimate-period.util';

describe('gain-estimate-period.util', () => {
  it('parseGainEstimatePeriod — défaut 30d', () => {
    expect(parseGainEstimatePeriod(undefined)).toBe('30d');
    expect(parseGainEstimatePeriod('bogus')).toBe('30d');
    expect(parseGainEstimatePeriod('7d')).toBe('7d');
    expect(parseGainEstimatePeriod('90d')).toBe('90d');
  });

  it('gainEstimatePeriodDays', () => {
    expect(gainEstimatePeriodDays('7d')).toBe(7);
    expect(gainEstimatePeriodDays('30d')).toBe(30);
    expect(gainEstimatePeriodDays('90d')).toBe(90);
  });
});
