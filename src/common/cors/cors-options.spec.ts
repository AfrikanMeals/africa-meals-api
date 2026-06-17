import {
  buildApiCorsOptions,
  normalizeCorsOrigin,
  parseCorsOrigins,
} from './cors-options';

describe('cors-options (H-01)', () => {
  const prevEnv = process.env;

  beforeEach(() => {
    process.env = { ...prevEnv };
  });

  afterAll(() => {
    process.env = prevEnv;
  });

  it('normalizes trailing slashes', () => {
    expect(normalizeCorsOrigin('https://admin.wise-eat.com/')).toBe(
      'https://admin.wise-eat.com',
    );
  });

  it('parses comma-separated origins', () => {
    const set = parseCorsOrigins(
      'https://wise-eat.com, https://admin.wise-eat.com/',
    );
    expect(set.has('https://wise-eat.com')).toBe(true);
    expect(set.has('https://admin.wise-eat.com')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('rejects unknown browser origins when allowlist is set', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://admin.wise-eat.com';
    const opts = buildApiCorsOptions();
    const originFn = opts.origin as (
      origin: string,
      cb: (err: Error | null, ok?: boolean) => void,
    ) => void;
    originFn('https://evil.example.com', (_err, ok) => {
      expect(ok).toBe(false);
      done();
    });
  });

  it('allows listed browser origins', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://admin.wise-eat.com';
    const opts = buildApiCorsOptions();
    const originFn = opts.origin as (
      origin: string,
      cb: (err: Error | null, ok?: boolean) => void,
    ) => void;
    originFn('https://admin.wise-eat.com', (_err, ok) => {
      expect(ok).toBe(true);
      done();
    });
  });

  it('allows requests without Origin (mobile native)', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://admin.wise-eat.com';
    const opts = buildApiCorsOptions();
    const originFn = opts.origin as (
      origin: string | undefined,
      cb: (err: Error | null, ok?: boolean) => void,
    ) => void;
    originFn(undefined, (_err, ok) => {
      expect(ok).toBe(true);
      done();
    });
  });
});
