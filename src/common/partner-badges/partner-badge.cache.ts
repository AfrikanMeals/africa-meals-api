import type { PartnerBadgeDefinition } from './partner-badge.constants';

let cachedDefinitions: PartnerBadgeDefinition[] = [];

export function setPartnerBadgeDefinitionsCache(
  defs: PartnerBadgeDefinition[],
): void {
  cachedDefinitions = [...defs].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
}

export function getPartnerBadgeDefinitionsCache(): PartnerBadgeDefinition[] {
  return cachedDefinitions;
}
