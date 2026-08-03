/**
 * Pont HTTPS → deep link mobile après Stripe Checkout (Ad Credit, SMS, abo).
 * Stripe refuse les schémas `wise-eat://` en success_url.
 */

export type MobileStripeReturnKind =
  | 'vendor_subscription'
  | 'ad_credit'
  | 'sms_billing';

/** True si le client demande le retour app (`client=mobile`). */
export function isMobileCheckoutClient(client?: string | null): boolean {
  return String(client ?? '')
    .trim()
    .toLowerCase() === 'mobile';
}

/**
 * Success URL Checkout → page pont API (placeholder Stripe `{CHECKOUT_SESSION_ID}`).
 */
export function buildMobileStripeCheckoutSuccessUrl(args: {
  serverUrl: string;
  kind: Exclude<MobileStripeReturnKind, 'vendor_subscription'> | MobileStripeReturnKind;
}): string {
  const server = args.serverUrl.replace(/\/$/, '') || 'http://localhost:9000';
  return `${server}/api/billing/stripe/mobile-return?kind=${encodeURIComponent(
    args.kind,
  )}&session_id={CHECKOUT_SESSION_ID}`;
}

/** Cancel URL = page HTML générique déjà utilisée par le panier. */
export function buildMobileStripeCheckoutCancelUrl(serverUrl: string): string {
  const server = serverUrl.replace(/\/$/, '') || 'http://localhost:9000';
  return `${server}/api/billing/stripe/payment-cancel`;
}

const KIND_TITLES: Record<MobileStripeReturnKind, string> = {
  vendor_subscription: 'Abonnement — Wise Eat',
  ad_credit: 'Crédit Ads — Wise Eat',
  sms_billing: 'Facture SMS — Wise Eat',
};

/**
 * Page HTML : ouvre `wise-eat://stripe-return?kind=…&session_id=…`.
 */
export function mobileStripeCheckoutReturnHtml(args: {
  sessionId: string;
  kind: MobileStripeReturnKind;
}): string {
  const sid = String(args.sessionId ?? '').replace(/[<>"'&]/g, '');
  const kind = args.kind;
  const deepLink = `wise-eat://stripe-return?kind=${encodeURIComponent(
    kind,
  )}&session_id=${encodeURIComponent(sid)}`;
  const escapedDeep = deepLink
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const title = KIND_TITLES[kind] ?? 'Paiement — Wise Eat';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:2rem 1.5rem;line-height:1.5;color:#1a1a1a;background:#faf9f7}
    h1{font-size:1.25rem;margin:0 0 .75rem}
    .btn{display:inline-block;margin-top:1.25rem;padding:.85rem 1.5rem;background:#5c3d2e;color:#fff;text-decoration:none;border-radius:10px;font-weight:600}
    .muted{color:#666;font-size:.9rem}
  </style>
</head>
<body>
  <h1>Paiement réussi</h1>
  <p class="muted">Redirection vers l’application Wise Eat…</p>
  <p><a class="btn" id="open-app" href="${escapedDeep}">Ouvrir l’application</a></p>
  <script>
    (function () {
      var deep = ${JSON.stringify(deepLink)};
      function openApp() {
        try { window.location.href = deep; } catch (e) {}
        try { window.location.replace(deep); } catch (e) {}
      }
      openApp();
      setTimeout(openApp, 600);
      setTimeout(openApp, 1500);
      var a = document.getElementById('open-app');
      if (a) a.addEventListener('click', function (e) {
        e.preventDefault();
        openApp();
      });
    })();
  </script>
</body>
</html>`;
}

/** Parse / valide le query `kind` du pont mobile. */
export function parseMobileStripeReturnKind(
  raw?: string | null,
): MobileStripeReturnKind | null {
  const k = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (k === 'vendor_subscription' || k === 'ad_credit' || k === 'sms_billing') {
    return k;
  }
  return null;
}
