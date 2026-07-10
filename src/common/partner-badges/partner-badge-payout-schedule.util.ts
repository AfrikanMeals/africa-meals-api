/**
 * Helpers purs — calendrier de versement Stripe selon le badge partenaire.
 * Stripe refuse souvent un `delay_days` inférieur au minimum pays (ex. CA = 7).
 */

/** Extrait le minimum `delay_days` depuis un message d’erreur Stripe. */
export function parseStripeMinDelayDaysFromError(
  message: string | null | undefined,
): number | null {
  const raw = String(message ?? '');
  const patterns = [
    /(?:at least|greater than or equal to|minimum(?: of)?)\s+(\d+)/i,
    /delay_days[^\d]{0,40}(\d+)/i,
    /must be (?:>=|≥)\s*(\d+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(raw);
    if (!m?.[1]) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 60) return Math.trunc(n);
  }
  return null;
}

/**
 * Délai effectif à envoyer à Stripe pour un badge « standard ».
 * `desired` vient du badge ; `stripeMinimum` du compte / erreur Stripe.
 */
export function resolveStripePayoutDelayDays(
  desired: number,
  stripeMinimum: number | null | undefined,
): number {
  const want = Math.max(0, Math.trunc(Number(desired) || 0));
  if (want <= 0) return 0;
  const min = Math.max(0, Math.trunc(Number(stripeMinimum) || 0));
  if (min <= 0) return want;
  return Math.max(want, min);
}

/** Indique si l’échec de payout est dû à un solde encore indisponible. */
export function isStripePayoutNoBalanceError(err: unknown): boolean {
  const parts: string[] = [];
  if (err instanceof Error) parts.push(err.message);
  if (err && typeof err === 'object') {
    const row = err as {
      response?: unknown;
      getResponse?: () => unknown;
    };
    if (typeof row.getResponse === 'function') {
      try {
        const r = row.getResponse();
        parts.push(typeof r === 'string' ? r : JSON.stringify(r));
      } catch {
        /* ignore */
      }
    }
    if (row.response != null) {
      parts.push(
        typeof row.response === 'string'
          ? row.response
          : JSON.stringify(row.response),
      );
    }
  } else if (err != null) {
    parts.push(String(err));
  }
  const hay = parts.join(' ').toLowerCase();
  return (
    hay.includes('stripe_payout_no_balance') ||
    hay.includes('insufficient') ||
    (hay.includes('no_balance') && hay.includes('payout'))
  );
}
