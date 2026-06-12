import {
  birdTemplateUrlButtonSuffix,
  phoneToBirdE164,
  readBirdSmsConfig,
  readBirdWhatsAppConfig,
} from './bird-channels.util';

describe('bird-channels.util', () => {
  it('lit la config SMS Bird', () => {
    const cfg = readBirdSmsConfig({
      BIRD_ACCESS_KEY: 'key',
      BIRD_WORKSPACE_ID: 'ws-1',
      BIRD_SMS_CHANNEL_ID: 'ch-sms',
    });
    expect(cfg?.smsChannelId).toBe('ch-sms');
    expect(cfg?.whatsappChannelId).toBeUndefined();
  });

  it('lit la config WhatsApp Bird', () => {
    const cfg = readBirdWhatsAppConfig({
      BIRD_ACCESS_KEY: 'key',
      BIRD_WORKSPACE_ID: 'ws-1',
      BIRD_WHATSAPP_CHANNEL_ID: 'ch-wa',
    });
    expect(cfg?.whatsappChannelId).toBe('ch-wa');
    expect(cfg?.smsChannelId).toBeUndefined();
  });

  it('convertit un numéro 10 chiffres en E.164', () => {
    expect(phoneToBirdE164('5145551234', '1')).toBe('+15145551234');
  });

  it('conserve un numéro E.164', () => {
    expect(phoneToBirdE164('+33612345678', '33')).toBe('+33612345678');
  });

  it('extrait le suffixe URL pour paramètre template', () => {
    const env = {
      AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_PREFIX:
        'https://api.example.com/ads/notifications/click/',
    } as NodeJS.ProcessEnv;
    expect(
      birdTemplateUrlButtonSuffix(
        'https://api.example.com/ads/notifications/click/abc-123',
        env,
      ),
    ).toBe('abc-123');
  });
});
