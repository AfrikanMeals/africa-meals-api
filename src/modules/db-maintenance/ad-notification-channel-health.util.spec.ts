import {
  channelHealthSummary,
  evaluateAdNotificationChannelHealth,
} from './ad-notification-channel-health.util';

describe('ad-notification-channel-health.util', () => {
  it('signale un canal admin activé sans runtime', () => {
    const evaluation = evaluateAdNotificationChannelHealth({
      availability: {
        email: true,
        push: false,
        inApp: false,
        sms: true,
        whatsapp: false,
      },
      env: {
        SMTP_HOST: '',
        AD_NOTIFICATION_SMS_ENABLED: 'true',
        REDIS_URL: 'redis://localhost:6379',
      } as NodeJS.ProcessEnv,
      firebaseMessagingOk: true,
      wsReachable: true,
      pricingDocFound: true,
      mqBrokerEnabled: true,
    });
    expect(evaluation.misconfiguredChannels).toContain('email');
    expect(evaluation.misconfiguredChannels).toContain('sms');
    const summary = channelHealthSummary(evaluation);
    expect(summary.status).toBe('degraded');
  });
});
