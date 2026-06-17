import {
  issueAdNotificationTrackToken,
  verifyAdNotificationTrackToken,
} from './ad-notification-track-token.util';

describe('ad-notification-track-token.util', () => {
  const secret = 'track-test-secret';

  it('émet et vérifie un jeton', () => {
    const token = issueAdNotificationTrackToken('del-1', secret, 3600);
    expect(
      verifyAdNotificationTrackToken('del-1', token, secret),
    ).toBe(true);
  });

  it('rejette un deliveryId différent', () => {
    const token = issueAdNotificationTrackToken('del-1', secret, 3600);
    expect(
      verifyAdNotificationTrackToken('del-2', token, secret),
    ).toBe(false);
  });
});
