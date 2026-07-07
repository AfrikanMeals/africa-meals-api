/** URL publique d’acceptation invitation livreur restaurant (site web, sans login). */
export function buildStoreDeliveryDriverInviteAcceptUrl(
  get: (key: string) => string | undefined,
  token: string,
): string {
  const base =
    get('PUBLIC_WEB_URL')?.trim() ||
    get('EMAIL_WEBSITE_URL')?.trim() ||
    get('FRONTEND_URL')?.trim() ||
    get('CLIENT_APP_URL')?.trim() ||
    'https://wise-eat.com';
  const root = base.replace(/\/+$/, '');
  const url = new URL(`${root}/courier`);
  url.searchParams.set('storeDriverInvite', token.trim());
  return url.toString();
}
