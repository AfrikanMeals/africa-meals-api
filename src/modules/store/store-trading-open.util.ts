/** Override manuel Ouvert/Fermé. */
export type StoreTradingOverride = 'open' | 'closed';

export type ResolveStoreTradingOpenInput = {
  status?: string | null;
  /** Verrou admin durable. `false` ferme même pendant un créneau. */
  acceptsOrders?: boolean | null;
  tradingOverride?: string | null;
  /** Fin d’exception du jour (mode horaires). Absent = override persistant (mode manuel). */
  tradingOverrideUntil?: Date | string | null;
  /** Planning actif avec au moins un jour commandable. */
  hasFixedHours?: boolean;
  /** Créneau courant ouvert. Ignoré sans horaires fixes. */
  hoursOpen?: boolean;
  now?: Date;
};

/**
 * Normalise le champ API/Mongo (`open` | `closed` | null).
 * Valeurs inconnues → null (suivre horaires, ou ouvert en mode manuel).
 */
export function normalizeTradingOverride(
  value: unknown,
): StoreTradingOverride | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'open') return 'open';
  if (raw === 'closed') return 'closed';
  return null;
}

function parseUntil(value: Date | string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Ouverture effective (badge + checkout immédiat).
 * Horaires fixes : créneau, sauf exception encore valide (`now < until`).
 * Sans horaires : `closed` persiste ; sinon ouvert.
 */
export function resolveStoreTradingOpen(
  input: ResolveStoreTradingOpenInput,
): boolean {
  const status = String(input.status ?? '')
    .trim()
    .toUpperCase();
  if (status && status !== 'ACTIVE') return false;
  // Verrou admin : distinct du switch du jour.
  if (input.acceptsOrders === false) return false;

  const now = input.now ?? new Date();
  const override = normalizeTradingOverride(input.tradingOverride);
  const until = parseUntil(input.tradingOverrideUntil);
  // Exception du jour : ignorée dès minuit local (until dépassé ou absent).
  const dayOverride =
    input.hasFixedHours === true &&
    override != null &&
    until != null &&
    now.getTime() < until.getTime();
  if (dayOverride) return override === 'open';

  if (input.hasFixedHours) return input.hoursOpen === true;

  if (override === 'closed') return false;
  return true;
}

/** Sync checkout / DB historique : open → true, closed → false. */
export function acceptsOrdersForTradingOverride(
  override: StoreTradingOverride,
): boolean {
  return override === 'open';
}

/**
 * Admin PATCH : `acceptsOrders` (verrou) et `tradingOverride` sont indépendants.
 * Ne dérive plus un `open` permanent depuis la checkbox (cassait les horaires).
 */
export function resolveTradingFieldsForAdminPatch(args: {
  tradingOverride?: unknown;
  acceptsOrders?: boolean | null;
}): { tradingOverride: StoreTradingOverride | null; acceptsOrders: boolean } {
  return {
    tradingOverride: normalizeTradingOverride(args.tradingOverride),
    acceptsOrders: args.acceptsOrders !== false,
  };
}
