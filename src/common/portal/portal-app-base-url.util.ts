/**
 * Base URL du portail admin / business pour les redirections Stripe (Connect, Checkout).
 * Évite de renvoyer VENDOR / PARTNER / DELIVERY vers admin.wise-eat.com (gate hostname + cookies host-only).
 */

export type PortalAppAudience = 'admin' | 'business';

/** ADMIN → portail admin ; tout autre rôle → business (vendeur, partenaire, livreur). */
export function portalAudienceForUserType(
  userType: string | null | undefined,
): PortalAppAudience {
  const t = String(userType ?? '')
    .trim()
    .toUpperCase();
  return t === 'ADMIN' ? 'admin' : 'business';
}

function trimBase(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * Résout la base HTTPS du portail pour les return/success/cancel Stripe.
 * Ordre business : BUSINESS_APP_URL → DASHBOARD_BASE_URL → FRONTEND_URL.
 * Ordre admin : STRIPE_CONNECT_ADMIN_BASE_URL → ADMIN_APP_URL.
 */
export function resolvePortalAppBaseUrl(args: {
  getEnv: (key: string) => string | undefined | null;
  userType?: string | null;
  /** Force l’audience (ex. onboarding boutique = toujours business). */
  audience?: PortalAppAudience;
  localhostFallback?: string;
}): string {
  const audience =
    args.audience ?? portalAudienceForUserType(args.userType);
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const v = trimBase(args.getEnv(key) ?? undefined);
      if (v) return v;
    }
    return '';
  };
  const fallback = trimBase(
    args.localhostFallback ?? 'http://localhost:3000',
  );

  if (audience === 'admin') {
    return (
      pick('STRIPE_CONNECT_ADMIN_BASE_URL', 'ADMIN_APP_URL') || fallback
    );
  }

  // Ne pas retomber sur ADMIN_APP_URL (casse les retours Connect / checkout business).
  return (
    pick(
      'BUSINESS_APP_URL',
      'STRIPE_CONNECT_BUSINESS_BASE_URL',
      'DASHBOARD_BASE_URL',
      'FRONTEND_URL',
    ) || fallback
  );
}
