import {
  buildLocatorAdminHtml,
  buildLocatorIframeHtml,
  isAllowedLocatorSrc,
  parseLocatorEmbed,
  parseLocatorEmbedSrc,
} from './store-locator-embed.util';

const VALID_SRC =
  'https://storage.googleapis.com/maps-solutions-df32zpre7y/locator-plus/oxfd/locator-plus.html';

/** Clé de test (format AIza) — pas une clé production. */
const FAKE_MAPS_KEY = 'AIzaSyDummyTestKeyForLocatorPlus0001';

const LOCATOR_PLUS_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>Locator</title>
    <script>
      const CONFIGURATION = {
        "locations": [
          {"title":"150 Rue Racine E","address1":"150 Rue Racine E","address2":"Chicoutimi, QC G7H 1R7, Canada","coords":{"lat":48.4277297435134,"lng":-71.063825864418},"placeId":"ChIJTestPlaceIdForLocatorPlus0001"}
        ],
        "mapOptions": {"center":{"lat":38.0,"lng":-100.0},"fullscreenControl":true,"mapTypeControl":false,"streetViewControl":false,"zoom":4,"zoomControl":true,"maxZoom":17,"mapId":""},
        "mapsApiKey": "${FAKE_MAPS_KEY}",
        "capabilities": {"input":true,"autocomplete":true,"directions":true,"distanceMatrix":true,"details":true,"actions":false}
      };
    </script>
  </head>
  <body>
    <gmpx-api-loader key="${FAKE_MAPS_KEY}" solution-channel="GMP_QB_locatorplus_v11_cABCDE"></gmpx-api-loader>
    <gmpx-store-locator map-id="DEMO_MAP_ID"></gmpx-store-locator>
  </body>
</html>`;

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

  it('extrait CONFIGURATION + clé Maps d’une page Locator Plus Quick Builder', () => {
    const parsed = parseLocatorEmbed(LOCATOR_PLUS_HTML);
    expect(parsed?.kind).toBe('locatorPlus');
    if (parsed?.kind !== 'locatorPlus') return;
    expect(parsed.config.mapsApiKey).toBe(FAKE_MAPS_KEY);
    expect(parsed.config.mapId).toBe('DEMO_MAP_ID');
    expect(parsed.config.configuration.locations[0]?.title).toBe(
      '150 Rue Racine E',
    );
    expect(parsed.config.configuration.locations[0]?.coords.lat).toBeCloseTo(
      48.4277297435134,
    );
    expect(parsed.config.configuration.capabilities.input).toBe(true);
  });

  it('refuse un HTML Locator Plus sans clé Maps / sans lieu', () => {
    expect(
      parseLocatorEmbed(
        '<html><script>const CONFIGURATION = {"locations":[]};</script></html>',
      ),
    ).toBeUndefined();
  });

  it('round-trip admin : HTML Locator Plus reconstruit reste parsable', () => {
    const parsed = parseLocatorEmbed(LOCATOR_PLUS_HTML);
    expect(parsed?.kind).toBe('locatorPlus');
    if (parsed?.kind !== 'locatorPlus') return;
    const html = buildLocatorAdminHtml('', parsed.config);
    const again = parseLocatorEmbed(html);
    expect(again?.kind).toBe('locatorPlus');
    if (again?.kind !== 'locatorPlus') return;
    expect(again.config.mapsApiKey).toBe(FAKE_MAPS_KEY);
    expect(again.config.configuration.locations).toHaveLength(1);
  });
});
