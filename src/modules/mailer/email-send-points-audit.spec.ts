import { EMAIL_SEND_POINTS } from './email-send-points.registry';

describe('email-send-points audit', () => {
  it('couvre tous les modules e-mail du registre plateforme', () => {
    const coveredModules = new Set(
      EMAIL_SEND_POINTS.map((p) => p.id.split('-')[0]),
    );
    expect(EMAIL_SEND_POINTS.length).toBeGreaterThanOrEqual(30);
    expect(coveredModules.size).toBeGreaterThanOrEqual(10);
  });

  it('chaque point d’envoi a une mitigation images documentée', () => {
    for (const point of EMAIL_SEND_POINTS) {
      expect(point.mitigation.trim().length).toBeGreaterThan(10);
      expect(['sendSimple', 'sendAdNotificationEmail']).toContain(
        point.transport,
      );
    }
  });

  it('les e-mails à images inline/hero/json_ld sont listés explicitement', () => {
    const withImages = EMAIL_SEND_POINTS.filter(
      (p) => p.imageRisk !== 'none' && p.imageRisk !== 'header_logo',
    ).map((p) => p.id);

    expect(withImages).toEqual(
      expect.arrayContaining([
        'order-paid-invoice',
        'order-shipped',
        'ad-notification',
        'gift-code-activation',
        'partner-onboarding',
        'ad-cash-grant',
        'platform-maintenance',
        'blog-newsletter',
        'food-newsletter',
        'test-email-media',
      ]),
    );
  });
});
