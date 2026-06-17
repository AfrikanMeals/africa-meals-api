import {
  corsOriginMatchesPattern,
  isCorsOriginAllowed,
} from './cors-origin-match.util';
import { normalizeCorsOrigin } from './cors-options';

describe('cors-origin-match.util', () => {
  it('matches https apex and subdomains for https://*.wise-eat.com', () => {
    expect(
      corsOriginMatchesPattern(
        'https://wise-eat.com',
        'https://*.wise-eat.com',
      ),
    ).toBe(true);
    expect(
      corsOriginMatchesPattern(
        'https://admin.wise-eat.com',
        'https://*.wise-eat.com',
      ),
    ).toBe(true);
    expect(
      corsOriginMatchesPattern(
        'https://api-dev.wise-eat.com',
        'https://*.wise-eat.com',
      ),
    ).toBe(true);
    expect(
      corsOriginMatchesPattern(
        'http://wise-eat.com',
        'https://*.wise-eat.com',
      ),
    ).toBe(false);
    expect(
      corsOriginMatchesPattern(
        'https://evil.example.com',
        'https://*.wise-eat.com',
      ),
    ).toBe(false);
  });

  it('always allows wise-eat.com browsers via built-in patterns', () => {
    const exact = new Set<string>();
    expect(
      isCorsOriginAllowed('https://wise-eat.com', exact),
    ).toBe(true);
    expect(
      isCorsOriginAllowed('https://www.wise-eat.com', exact),
    ).toBe(true);
    expect(
      isCorsOriginAllowed('http://localhost:5002', exact),
    ).toBe(false);
  });

  it('respects explicit allowlist entries', () => {
    const exact = new Set([normalizeCorsOrigin('http://localhost:5002')]);
    expect(
      isCorsOriginAllowed('http://localhost:5002', exact),
    ).toBe(true);
  });
});
