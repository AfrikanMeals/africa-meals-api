/**
 * Conversion vers CAD (Fawaz currency-api) pour Gain Estimate.
 * Même CDN que l’admin — pas de dépendance au BFF.
 */

const PRIMARY_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cad.min.json';
const FALLBACK_URL =
  'https://latest.currency-api.pages.dev/v1/currencies/cad.min.json';

export type CadFxRates = {
  date: string;
  /** Unités de devise étrangère pour 1 CAD. */
  unitsPerCad: Record<string, number>;
};

function parseRatesPayload(data: unknown): CadFxRates | null {
  if (typeof data !== 'object' || data === null) return null;
  const root = data as Record<string, unknown>;
  const date = typeof root.date === 'string' ? root.date : 'latest';
  const cad = root.cad;
  if (typeof cad !== 'object' || cad === null) return null;
  const unitsPerCad: Record<string, number> = {};
  for (const [key, raw] of Object.entries(cad as Record<string, unknown>)) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) {
      unitsPerCad[key.toLowerCase()] = n;
    }
  }
  if (Object.keys(unitsPerCad).length === 0) return null;
  return { date, unitsPerCad };
}

async function fetchFromUrl(url: string): Promise<CadFxRates> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json().catch(() => null)) as unknown;
  const parsed = parseRatesPayload(data);
  if (!parsed) throw new Error('invalid_payload');
  return parsed;
}

/** Charge les taux base CAD (jsDelivr puis repli). */
export async function fetchCadFxRates(): Promise<CadFxRates | null> {
  try {
    return await fetchFromUrl(PRIMARY_URL);
  } catch {
    try {
      return await fetchFromUrl(FALLBACK_URL);
    } catch {
      return null;
    }
  }
}

export function normalizeFxCurrency(raw: string | undefined | null): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase();
}

/**
 * Convertit un montant majeur (ex. 12.50) vers CAD.
 * Retourne null si devise inconnue / sans taux.
 */
export function convertMajorToCad(
  amountMajor: number,
  currency: string | undefined | null,
  rates: CadFxRates | null,
): number | null {
  if (!Number.isFinite(amountMajor)) return null;
  const code = normalizeFxCurrency(currency) || 'CAD';
  if (code === 'CAD') return amountMajor;
  if (!rates) return null;
  const units = rates.unitsPerCad[code.toLowerCase()];
  if (!units || units <= 0) return null;
  // units = foreign per 1 CAD → CAD = foreign / units
  return amountMajor / units;
}

/** Convertit des centimes (minor) vers CAD. */
export function convertCentsToCad(
  cents: number,
  currency: string | undefined | null,
  rates: CadFxRates | null,
): number | null {
  if (!Number.isFinite(cents)) return null;
  return convertMajorToCad(cents / 100, currency, rates);
}

/**
 * Agrège des lignes { currency, amountCents } → CAD + unconverted.
 */
export function sumCentsByCurrencyToCad(
  rows: Array<{ currency: string; amountCents: number }>,
  rates: CadFxRates | null,
  source: string,
): { cad: number; unconverted: Array<{ currency: string; amountMajor: number; source: string }> } {
  let cad = 0;
  const unconverted: Array<{
    currency: string;
    amountMajor: number;
    source: string;
  }> = [];
  for (const row of rows) {
    const cents = Math.max(0, Math.round(Number(row.amountCents) || 0));
    if (cents <= 0) continue;
    const converted = convertCentsToCad(cents, row.currency, rates);
    if (converted == null) {
      unconverted.push({
        currency: normalizeFxCurrency(row.currency) || 'UNK',
        amountMajor: cents / 100,
        source,
      });
      continue;
    }
    cad += converted;
  }
  return { cad, unconverted };
}
