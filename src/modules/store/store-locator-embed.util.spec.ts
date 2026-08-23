import {
  buildLocatorIframeHtml,
  isAllowedLocatorSrc,
  parseLocatorEmbedSrc,
} from './store-locator-embed.util';

const VALID_SRC =
  'https://storage.googleapis.com/maps-solutions-df32zpre7y/locator-plus/oxfd/locator-plus.html';

const VALID_IFRAME = `<iframe src="${VALID_SRC}"
  width="100%" height="100%"
  style="border:0;"
  loading="lazy">
</iframe>`;

describe('store-locator-embed.util', () => {
  it('extrait la src d’un iframe Locator Plus Google', () => {
    expect(parseLocatorEmbedSrc(VALID_IFRAME)).toBe(VALID_SRC);
  });

  it('accepte une URL HTTPS nue allowlistée', () => {
    expect(parseLocatorEmbedSrc(`  ${VALID_SRC}  `)).toBe(VALID_SRC);
  });

  it('vide / blanc → null (effacement du champ)', () => {
    expect(parseLocatorEmbedSrc('')).toBeNull();
    expect(parseLocatorEmbedSrc('   ')).toBeNull();
  });

  it('undefined / null → undefined (ne pas toucher au champ)', () => {
    expect(parseLocatorEmbedSrc(undefined)).toBeUndefined();
    expect(parseLocatorEmbedSrc(null)).toBeUndefined();
  });

  it('rejette javascript:, http, et un hôte hors allowlist', () => {
    expect(
      parseLocatorEmbedSrc('<iframe src="javascript:alert(1)"></iframe>'),
    ).toBeUndefined();
    expect(parseLocatorEmbedSrc('http://storage.googleapis.com/x')).toBeUndefined();
    expect(
      parseLocatorEmbedSrc(
        '<iframe src="https://evil.example/locator.html"></iframe>',
      ),
    ).toBeUndefined();
  });

  it('rejette un fichier GCS hors maps-solutions / locator-plus', () => {
    expect(
      isAllowedLocatorSrc('https://storage.googleapis.com/my-bucket/page.html'),
    ).toBe(false);
  });

  it('reconstruit un iframe admin sans casser la src', () => {
    const html = buildLocatorIframeHtml(VALID_SRC);
    expect(html).toContain(`src="${VALID_SRC}"`);
    expect(parseLocatorEmbedSrc(html)).toBe(VALID_SRC);
  });
});
