import { isValidIanaTimezone } from '@modules/store/store-working-hours.util';

export const DEFAULT_FALLBACK_TIMEZONE = 'America/Toronto';

/** Fuseaux IANA par défaut (ISO2 → timezone). */
export const DEFAULT_REGION_TIMEZONES: Record<string, string> = {
  CA: 'America/Toronto',
  US: 'America/New_York',
  FR: 'Europe/Paris',
  BE: 'Europe/Brussels',
  CH: 'Europe/Zurich',
  SN: 'Africa/Dakar',
  CI: 'Africa/Abidjan',
  CM: 'Africa/Douala',
  MA: 'Africa/Casablanca',
  TG: 'Africa/Lome',
  BJ: 'Africa/Porto-Novo',
  GA: 'Africa/Libreville',
  CD: 'Africa/Kinshasa',
  BF: 'Africa/Ouagadougou',
  ML: 'Africa/Bamako',
};

const WEEKDAY_TO_JS: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

export function defaultTimezoneForCountry(code: string): string {
  const c = String(code ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) {
    return DEFAULT_FALLBACK_TIMEZONE;
  }
  return DEFAULT_REGION_TIMEZONES[c] ?? DEFAULT_FALLBACK_TIMEZONE;
}

export function normalizeRegionTimezone(
  value: unknown,
  countryCode?: string,
): string {
  const tz = String(value ?? '').trim();
  if (tz && isValidIanaTimezone(tz)) {
    return tz;
  }
  return defaultTimezoneForCountry(countryCode ?? '');
}

export function resolveEffectiveTimezone(args: {
  storeTimezone?: string | null;
  regionTimezone?: string | null;
  regionCode?: string | null;
}): string {
  const storeTz = String(args.storeTimezone ?? '').trim();
  if (storeTz && isValidIanaTimezone(storeTz)) {
    return storeTz;
  }
  const regionTz = String(args.regionTimezone ?? '').trim();
  if (regionTz && isValidIanaTimezone(regionTz)) {
    return regionTz;
  }
  return defaultTimezoneForCountry(args.regionCode ?? '');
}

/** 0 = dimanche … 6 = samedi (convention `Date.getDay()`). */
export function jsDayOfWeekInTimezone(
  timezone: string,
  at: Date = new Date(),
): number {
  const tz = normalizeRegionTimezone(timezone);
  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
    }).format(at);
    const dow = WEEKDAY_TO_JS[weekday];
    if (typeof dow === 'number') return dow;
  } catch {
    /* fallback below */
  }
  return at.getUTCDay();
}

/** Branches Mongo `$switch` : code région → fuseau IANA. */
export function mongoRegionTimezoneSwitchExpr(
  regionTimezoneMap: Record<string, string>,
  regionField: string | Record<string, unknown> = '$region',
): Record<string, unknown> {
  const branches = Object.entries(regionTimezoneMap).map(([code, tz]) => ({
    case: {
      $eq: [{ $toUpper: regionField }, code],
    },
    then: tz,
  }));
  return {
    $switch: {
      branches,
      default: DEFAULT_FALLBACK_TIMEZONE,
    },
  };
}

/** Fuseau effectif boutique : override vendeur → région → défaut. */
export function mongoEffectiveStoreTimezoneExpr(
  regionTimezoneMap: Record<string, string>,
  opts?: {
    storeTimezoneField?: string;
    regionField?: string | Record<string, unknown>;
  },
): Record<string, unknown> {
  const storeTimezoneField = opts?.storeTimezoneField ?? '$timezone';
  const regionField = opts?.regionField ?? '$region';
  const regionTz = mongoRegionTimezoneSwitchExpr(
    regionTimezoneMap,
    regionField,
  );
  return {
    $let: {
      vars: {
        storeTz: {
          $trim: {
            input: { $ifNull: [storeTimezoneField, ''] },
          },
        },
      },
      in: {
        $cond: [
          { $gt: [{ $strLenCP: '$$storeTz' }, 0] },
          '$$storeTz',
          regionTz,
        ],
      },
    },
  };
}

/** Jour courant JS (0–6) dans le fuseau donné (agrégation Mongo). */
export function mongoJsDayOfWeekExpr(
  timezoneExpr: Record<string, unknown>,
): Record<string, unknown> {
  return {
    $subtract: [
      {
        $dayOfWeek: {
          date: '$$NOW',
          timezone: timezoneExpr,
        },
      },
      1,
    ],
  };
}
