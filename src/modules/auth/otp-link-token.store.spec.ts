import { OtpLinkTokenStore } from './otp-link-token.store';

describe('OtpLinkTokenStore', () => {
  const memoryRedis = {
    isConfigured: () => false,
    isEnabled: () => false,
    getClient: () => null,
  } as never;

  it('issues and consumes a one-time OTP link token', async () => {
    const store = new OtpLinkTokenStore(memoryRedis);
    const token = await store.issue(
      { email: 'user@test.com', code: 'AB12CD', flow: 'verify' },
      900,
    );
    const payload = await store.consume(token);
    expect(payload).toEqual({
      email: 'user@test.com',
      code: 'AB12CD',
      flow: 'verify',
    });
    await expect(store.consume(token)).resolves.toBeNull();
  });
});
