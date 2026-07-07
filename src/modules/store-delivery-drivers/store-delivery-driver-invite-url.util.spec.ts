import { buildStoreDeliveryDriverInviteAcceptUrl } from './store-delivery-driver-invite-url.util';

describe('buildStoreDeliveryDriverInviteAcceptUrl', () => {
  it('uses PUBLIC_WEB_URL and /courier path', () => {
    const url = buildStoreDeliveryDriverInviteAcceptUrl(
      (key) =>
        key === 'PUBLIC_WEB_URL' ? 'https://wise-eat.com/' : undefined,
      'abc123',
    );
    expect(url).toBe(
      'https://wise-eat.com/courier?storeDriverInvite=abc123',
    );
  });

  it('does not use DASHBOARD_BASE_URL', () => {
    const url = buildStoreDeliveryDriverInviteAcceptUrl(
      (key) =>
        key === 'DASHBOARD_BASE_URL'
          ? 'https://admin.wise-eat.com'
          : undefined,
      'tok',
    );
    expect(url).toBe('https://wise-eat.com/courier?storeDriverInvite=tok');
  });
});
