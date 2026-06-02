import {
  phoneToWhatsAppCloudRecipient,
  whatsAppTemplateUrlButtonSuffix,
} from './meta-whatsapp.util';

describe('meta-whatsapp.util', () => {
  it('convertit un numéro 10 chiffres CA en digits Cloud API', () => {
    expect(phoneToWhatsAppCloudRecipient('5145551234', '1')).toBe('15145551234');
  });

  it('conserve un numéro E.164', () => {
    expect(phoneToWhatsAppCloudRecipient('+33612345678', '33')).toBe(
      '33612345678',
    );
  });

  it('extrait le suffixe URL pour bouton template', () => {
    const env = {
      AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_PREFIX:
        'https://api.example.com/ads/notifications/click/',
    } as NodeJS.ProcessEnv;
    expect(
      whatsAppTemplateUrlButtonSuffix(
        'https://api.example.com/ads/notifications/click/abc-123',
        env,
      ),
    ).toBe('abc-123');
  });
});
