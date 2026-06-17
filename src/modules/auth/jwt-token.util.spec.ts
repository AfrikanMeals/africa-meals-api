import { parseJwtDurationToSeconds } from './jwt-token.util';

describe('jwt-token.util (H-03)', () => {
  it('parses minutes and days', () => {
    expect(parseJwtDurationToSeconds('30m', 60)).toBe(1800);
    expect(parseJwtDurationToSeconds('7d', 60)).toBe(7 * 86_400);
  });

  it('falls back on invalid input', () => {
    expect(parseJwtDurationToSeconds('invalid', 120)).toBe(120);
  });
});
