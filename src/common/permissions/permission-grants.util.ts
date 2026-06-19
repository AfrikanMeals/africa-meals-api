/**
 * Résolution permission requise ↔ permissions accordées (bundles legacy inclus).
 */
export function permissionGranted(
  granted: readonly string[],
  required: string,
  bundleGrants: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (granted.includes(required)) return true;
  for (const g of granted) {
    const implied = bundleGrants[g];
    if (implied?.includes(required)) return true;
  }
  return false;
}

export function expandGrantedPermissions(
  granted: readonly string[],
  bundleGrants: Readonly<Record<string, readonly string[]>>,
): string[] {
  const set = new Set<string>(granted);
  for (const g of granted) {
    for (const implied of bundleGrants[g] ?? []) {
      set.add(implied);
    }
  }
  return [...set];
}
