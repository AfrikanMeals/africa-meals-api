export type GeocodeFeature = {
  id?: string;
  place_name: string;
  center: [number, number];
  text?: string;
  context?: Array<{ id?: string; text: string; short_code?: string }>;
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: [number, number] };
};

function pickAddressField(
  addr: Record<string, unknown> | undefined,
  keys: string[],
): string {
  if (!addr) return '';
  for (const k of keys) {
    const v = String(addr[k] ?? '').trim();
    if (v) return v;
  }
  return '';
}

export function nominatimToFeature(item: Record<string, unknown>): GeocodeFeature {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  const addr = item.address as Record<string, unknown> | undefined;
  const street = pickAddressField(addr, ['road', 'pedestrian', 'footway']);
  const house = pickAddressField(addr, ['house_number']);
  const line = [house, street].filter(Boolean).join(' ').trim();
  const city = pickAddressField(addr, [
    'city',
    'town',
    'village',
    'municipality',
    'county',
  ]);
  const zip = pickAddressField(addr, ['postcode']);
  const country = pickAddressField(addr, ['country']);
  const cc = pickAddressField(addr, ['country_code']).toUpperCase();
  const display = String(item.display_name ?? '').trim();
  const context: GeocodeFeature['context'] = [];
  if (zip) context.push({ id: 'postcode.0', text: zip });
  if (city) context.push({ id: 'place.0', text: city });
  if (country) {
    context.push({
      id: 'country.0',
      text: country,
      short_code: cc.toLowerCase(),
    });
  }
  return {
    id: String(item.place_id ?? `osm.${lat},${lng}`),
    place_name: display || line || `${lat}, ${lng}`,
    center: [lng, lat],
    text: line || display.split(',')[0]?.trim() || display,
    context,
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

export function mapboxV6ToFeature(item: Record<string, unknown>): GeocodeFeature | null {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  // v6 : coordinates dans properties ; parfois à la racine (Search Box).
  const coords = (props.coordinates ?? item.coordinates) as
    | Record<string, unknown>
    | undefined;
  const geom = item.geometry as { coordinates?: unknown } | undefined;
  const geomPair = Array.isArray(geom?.coordinates) ? geom.coordinates : null;
  const centerPair = Array.isArray(item.center) ? item.center : null;
  const lng = Number(
    coords?.longitude ??
      coords?.lng ??
      (geomPair ? geomPair[0] : undefined) ??
      (centerPair ? centerPair[0] : undefined),
  );
  const lat = Number(
    coords?.latitude ??
      coords?.lat ??
      (geomPair ? geomPair[1] : undefined) ??
      (centerPair ? centerPair[1] : undefined),
  );
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const coordsAccuracy = String(coords?.accuracy ?? props.accuracy ?? '').trim();
  const ctx = (props.context ?? {}) as Record<string, unknown>;
  const postcode = ctx.postcode as Record<string, unknown> | undefined;
  const place = ctx.place as Record<string, unknown> | undefined;
  const country = ctx.country as Record<string, unknown> | undefined;
  const context: GeocodeFeature['context'] = [];
  const zip = String(postcode?.name ?? '').trim();
  const city = String(place?.name ?? '').trim();
  const countryName = String(country?.name ?? '').trim();
  const cc = String(country?.country_code ?? '').trim().toLowerCase();
  if (zip) context.push({ id: 'postcode.0', text: zip });
  if (city) context.push({ id: 'place.0', text: city });
  if (countryName) {
    context.push({
      id: 'country.0',
      text: countryName,
      short_code: cc || undefined,
    });
  }
  const fullAddress = String(
    props.full_address ?? props.name ?? item.name ?? '',
  ).trim();
  return {
    id: String(item.id ?? item.mapbox_id ?? `${lng},${lat}`),
    place_name: fullAddress || `${lat}, ${lng}`,
    center: [lng, lat],
    text: String(props.name ?? fullAddress.split(',')[0] ?? '').trim(),
    context,
    properties: {
      ...props,
      // Fix: conserver accuracy rooftop pour classer le pin (pas le centroïde de rue).
      ...(coordsAccuracy ? { accuracy: coordsAccuracy } : {}),
    },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

export function structuredSearchToFeature(args: {
  address: string;
  city: string;
  country: string;
  zipCode: string;
  countryCode: string;
  location: [number, number];
}): GeocodeFeature {
  const [lng, lat] = args.location;
  const display = [args.address, args.zipCode, args.city, args.country]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(', ');
  return {
    id: `structured.${normalizeStructuredKey(args)}`,
    place_name: display,
    center: [lng, lat],
    text: args.address,
    context: [
      ...(args.zipCode
        ? [{ id: 'postcode.0', text: args.zipCode }]
        : []),
      ...(args.city ? [{ id: 'place.0', text: args.city }] : []),
      ...(args.country
        ? [
            {
              id: 'country.0',
              text: args.country,
              short_code: args.countryCode.toLowerCase(),
            },
          ]
        : []),
    ],
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

function normalizeStructuredKey(args: {
  address: string;
  city: string;
  country: string;
  zipCode: string;
  countryCode: string;
}): string {
  return [
    args.address,
    args.city,
    args.country,
    args.zipCode,
    args.countryCode,
  ]
    .map((s) => String(s ?? '').trim().toLowerCase())
    .join('|');
}
