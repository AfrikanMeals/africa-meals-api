import {
  normalizeWhatsAppAddress,
  phoneToWhatsAppRecipient,
} from './twilio-whatsapp.util';

describe('twilio-whatsapp.util', () => {
  it('normalise whatsapp:+', () => {
    expect(normalizeWhatsAppAddress('+15145551234')).toBe(
      'whatsapp:+15145551234',
    );
    expect(normalizeWhatsAppAddress('whatsapp:+15145551234')).toBe(
      'whatsapp:+15145551234',
    );
  });

  it('convertit un numéro 10 chiffres CA', () => {
    expect(phoneToWhatsAppRecipient('5145551234', '1')).toBe(
      'whatsapp:+15145551234',
    );
  });
});
