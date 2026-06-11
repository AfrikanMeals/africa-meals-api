import {
  readGoogleMerchantBasicAuthCredentials,
  verifyGoogleMerchantBasicAuthHeader,
  checkGoogleMerchantBasicAuth,
} from './google-merchant-basic-auth.util';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

describe('google-merchant-basic-auth.util', () => {
  const config = {
    get: (key: string) => {
      if (key === 'GOOGLE_MERCHANT_BASIC_AUTH_USER') return 'merchant';
      if (key === 'GOOGLE_MERCHANT_BASIC_AUTH_PASSWORD') return 'secret-pass';
      return undefined;
    },
  } as ConfigService;

  it('reads credentials from config', () => {
    expect(readGoogleMerchantBasicAuthCredentials(config)).toEqual({
      user: 'merchant',
      password: 'secret-pass',
    });
  });

  it('validates Basic auth header', () => {
    const token = Buffer.from('merchant:secret-pass').toString('base64');
    expect(
      verifyGoogleMerchantBasicAuthHeader(
        `Basic ${token}`,
        'merchant',
        'secret-pass',
      ),
    ).toBe(true);
    expect(
      verifyGoogleMerchantBasicAuthHeader(
        `Basic ${token}`,
        'merchant',
        'wrong',
      ),
    ).toBe(false);
  });

  it('reports auth failure reasons', () => {
    const req = { headers: {} } as Request;
    expect(checkGoogleMerchantBasicAuth(req, config)).toEqual({
      ok: false,
      status: 401,
      reason: 'missing_authorization_header',
      body: 'Unauthorized',
    });

    const badScheme = {
      headers: { authorization: 'Bearer token' },
    } as Request;
    expect(checkGoogleMerchantBasicAuth(badScheme, config)).toEqual({
      ok: false,
      status: 401,
      reason: 'invalid_authorization_scheme',
      body: 'Unauthorized',
    });

    const token = Buffer.from('merchant:secret-pass').toString('base64');
    const okReq = {
      headers: { authorization: `Basic ${token}` },
    } as Request;
    expect(checkGoogleMerchantBasicAuth(okReq, config)).toEqual({
      ok: true,
      user: 'merchant',
    });
  });
});
