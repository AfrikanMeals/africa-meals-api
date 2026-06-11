import { ConfigService } from '@nestjs/config';
import {
  readGoogleMerchantBasicAuthCredentials,
  verifyGoogleMerchantBasicAuthHeader,
} from './google-merchant-basic-auth.util';

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
});
