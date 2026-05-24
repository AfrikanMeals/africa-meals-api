/** Page HTML : pont HTTPS → deep link `wise-eat://` (Stripe exige une URL https en success_url). */
export function subscriptionCheckoutReturnHtml(sessionId: string): string {
  const sid = sessionId.replace(/[<>"'&]/g, '');
  const deepLink = `wise-eat://stripe-return?kind=vendor_subscription&session_id=${encodeURIComponent(sid)}`;
  const escapedDeep = deepLink
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Abonnement — Afrika Meals</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:2rem 1.5rem;line-height:1.5;color:#1a1a1a;background:#faf9f7}
    h1{font-size:1.25rem;margin:0 0 .75rem}
    .btn{display:inline-block;margin-top:1.25rem;padding:.85rem 1.5rem;background:#5c3d2e;color:#fff;text-decoration:none;border-radius:10px;font-weight:600}
    .muted{color:#666;font-size:.9rem}
  </style>
</head>
<body>
  <h1>Paiement réussi</h1>
  <p class="muted">Redirection vers l’application Afrika Meals…</p>
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
