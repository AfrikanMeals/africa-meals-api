/**
 * Fusion scores Mongo + rang Neo4j (fail-open : sans graphe → score Mongo seul).
 * Borné pour ne pas écraser totalement le ranking Mongo.
 */

export type RecoBlendWeights = {
  /** Bonus max ajouté au score Mongo (défaut 0.35). */
  maxBoost: number
  /** Décroissance par rang graphe (1er = maxBoost). */
  rankDecay: number
}

export const DEFAULT_RECO_BLEND_WEIGHTS: RecoBlendWeights = {
  maxBoost: 0.35,
  rankDecay: 0.85,
}

/**
 * Construit un map id → rang (0 = meilleur) à partir d’une liste ordonnée Neo4j.
 */
export function graphRankById(ids: string[] | null | undefined): Map<string, number> {
  const map = new Map<string, number>()
  if (!ids?.length) return map
  let rank = 0
  for (const raw of ids) {
    const id = String(raw ?? '').trim()
    if (!id || map.has(id)) continue
    map.set(id, rank)
    rank += 1
  }
  return map
}

/**
 * Fusionne listes d’IDs graphe (FBT, similar, collab) en préservant l’ordre d’apparition.
 */
export function mergeGraphIdLists(
  lists: Array<string[] | null | undefined>,
  limit: number,
): string[] {
  const take = Math.min(96, Math.max(1, Math.floor(limit) || 24))
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    if (!list?.length) continue
    for (const raw of list) {
      const id = String(raw ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
      if (out.length >= take) return out
    }
  }
  return out
}

/**
 * Score final = mongoScore + boost décroissant selon le rang graphe.
 * Absent du graphe → mongoScore inchangé.
 */
export function blendRecoScores(
  mongoScore: number,
  graphRank: number | undefined,
  weights: RecoBlendWeights = DEFAULT_RECO_BLEND_WEIGHTS,
): number {
  const base = Number.isFinite(mongoScore) ? mongoScore : 0
  if (graphRank == null || graphRank < 0 || !Number.isFinite(graphRank)) {
    return base
  }
  const maxBoost = Math.max(0, weights.maxBoost)
  const decay = Math.min(0.99, Math.max(0.01, weights.rankDecay))
  const boost = maxBoost * Math.pow(decay, graphRank)
  return base + boost
}

/**
 * Soft-boost ads : +bonus si store ou product est dans les sets graphe.
 */
export function adsGraphSoftBoost(opts: {
  mongoScore: number
  storeId?: string | null
  productId?: string | null
  graphStoreIds: Set<string>
  graphProductIds: Set<string>
  bonus?: number
}): number {
  const base = Number.isFinite(opts.mongoScore) ? opts.mongoScore : 0
  const bonus = opts.bonus ?? 0.12
  const sid = String(opts.storeId ?? '').trim()
  const pid = String(opts.productId ?? '').trim()
  let add = 0
  if (sid && opts.graphStoreIds.has(sid)) add += bonus
  if (pid && opts.graphProductIds.has(pid)) add += bonus
  return base + add
}

/**
 * Préfixe les IDs zone-delivery devant une liste store (dédup).
 */
export function prioritizeStoreIdsByZone(
  baseIds: string[],
  zoneStoreIds: string[] | null | undefined,
  limit: number,
): string[] {
  const take = Math.min(96, Math.max(1, Math.floor(limit) || 24))
  return mergeGraphIdLists([zoneStoreIds, baseIds], take)
}
