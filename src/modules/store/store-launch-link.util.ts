/** Deep link app mobile — ouvre le menu boutique. */
export function buildStoreAppDeepLink(args: {
  appScheme?: string;
  storeId: string;
  storeName: string;
}): string {
  const scheme = (args.appScheme ?? 'wise-eat').replace(/:\/\//, '');
  const id = args.storeId.trim();
  const name = encodeURIComponent(args.storeName.trim() || 'Restaurant');
  return `${scheme}://open/store/${id}/${name}`;
}
