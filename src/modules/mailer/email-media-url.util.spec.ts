import {
  emailHtmlImageNeedsMediaResolve,
  resolveAllEmailHtmlStorageUrls,
  resolveEmailHtmlMediaUrls,
} from './email-media-url.util';

describe('email-media-url.util', () => {
  describe('emailHtmlImageNeedsMediaResolve', () => {
    it('detects legacy Firebase Storage URLs', () => {
      expect(
        emailHtmlImageNeedsMediaResolve(
          'https://firebasestorage.googleapis.com/v0/b/wise-eat-ca/o/logo.png?alt=media',
        ),
      ).toBe(true);
    });

    it('ignores static site assets', () => {
      expect(
        emailHtmlImageNeedsMediaResolve(
          'https://wise-eat.com/images/email-heroes/vendor-onboarding-01.png',
        ),
      ).toBe(false);
    });
  });

  describe('resolveEmailHtmlMediaUrls', () => {
  it('rewrites Firebase img src to web vitrine', async () => {
    const legacy =
      'https://firebasestorage.googleapis.com/v0/b/wise-eat-ca/o/catalog%2Fmeal.jpg?alt=media';
    const web = 'https://wise-eat.com/images/email/catalog/meal.jpg';
    const html = `<p><img src="${legacy}" alt="Plat" width="64" /></p>`;

    const out = await resolveEmailHtmlMediaUrls(html, async (url) =>
      url === legacy ? web : url,
    );

    expect(out).toContain(`src="${web}"`);
    expect(out).not.toContain('firebasestorage.googleapis.com');
    expect(out).not.toContain('storage.googleapis.com');
  });

    it('leaves non-storage images unchanged', async () => {
      const html =
        '<img src="https://wise-eat.com/images/help/help-section-01.png" alt="Aide" />';
      const resolve = jest.fn(async (url: string) => url);

      const out = await resolveEmailHtmlMediaUrls(html, resolve);

      expect(out).toBe(html);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('decodes HTML entities before resolving', async () => {
      const legacy =
        'https://firebasestorage.googleapis.com/v0/b/wise-eat-ca/o/a%2Fb.png?alt=media&amp;token=abc';
      const decoded =
        'https://firebasestorage.googleapis.com/v0/b/wise-eat-ca/o/a%2Fb.png?alt=media&token=abc';
      const web = 'https://wise-eat.com/images/email/fallback.png';
      const html = `<img src="${legacy}" alt="" />`;

      const out = await resolveEmailHtmlMediaUrls(html, async (url) =>
        url === decoded ? web : url,
      );

      expect(out).toContain(web);
    });

    it('rewrites JSON-LD merchant.logo (HTML pré-enveloppé commande)', async () => {
      const legacy =
        'https://firebasestorage.googleapis.com/v0/b/wise-eat-ca/o/platform-theme%2Flogo.png?alt=media';
      const web = 'https://wise-eat.com/logo.png';
      const html = `<!DOCTYPE html><html><head>
  <script type="application/ld+json">{"@type":"Order","merchant":{"logo":"${legacy}"}}</script>
</head><body><img src="${legacy}" alt="" /></body></html>`;

      const out = await resolveAllEmailHtmlStorageUrls(html, async (url) =>
        url === legacy ? web : url,
      );

      expect(out).toContain(web);
      expect(out).not.toContain('firebasestorage.googleapis.com');
    });
  });
});
