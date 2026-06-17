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
        AD_SMTP_USER: '',
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

  it('valide le profil AD_SMTP pour le canal e-mail ads', () => {
    const evaluation = evaluateAdNotificationChannelHealth({
      availability: {
        email: true,
        push: false,
        inApp: false,
        sms: false,
        whatsapp: false,
      },
      env: {
        AD_SMTP_USER: 'sales@example.com',
        AD_SMTP_APP_PASSWORD: 'secret',
        REDIS_URL: 'redis://localhost:6379',
      } as NodeJS.ProcessEnv,
      firebaseMessagingOk: true,
      wsReachable: true,
      pricingDocFound: true,
      mqBrokerEnabled: true,
    });
    expect(evaluation.misconfiguredChannels).not.toContain('email');
  });
});
