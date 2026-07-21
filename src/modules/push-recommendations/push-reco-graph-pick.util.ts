import { PushRecommendationCandidateType } from '@schemas/push-recommendation-candidate.schema'

/**
 * Choisit le type push + produit prioritaire selon signaux Neo4j (IDs ordonnés).
 * Fail-open : listes vides → null (appelant garde le top feed Mongo).
 */
export function pickPushCandidateFromGraph(opts: {
  enabledTypes: PushRecommendationCandidateType[]
  feedProducts: Array<Record<string, unknown>>
  graphProductIds: string[] | null | undefined
  graphStoreIds: string[] | null | undefined
}): {
  product: Record<string, unknown>
  candidateType: PushRecommendationCandidateType
  reasonTags: string[]
  scoreBoost: number
} | null {
  const products = opts.feedProducts ?? []
  if (!products.length) return null

  const byId = new Map<string, Record<string, unknown>>()
  for (const p of products) {
    const id = String(p._id ?? p.id ?? '').trim()
    if (id) byId.set(id, p)
  }

  const graphProducts = (opts.graphProductIds ?? [])
    .map((x) => String(x).trim())
    .filter(Boolean)
  const graphStores = new Set(
    (opts.graphStoreIds ?? []).map((x) => String(x).trim()).filter(Boolean),
  )

  // 1. Produit graphe présent dans le feed → REORDER ou CROSS_CUISINE
  for (let i = 0; i < graphProducts.length; i++) {
    const hit = byId.get(graphProducts[i]!)
    if (!hit) continue
    const preferReorder = opts.enabledTypes.includes(
      PushRecommendationCandidateType.REORDER_FAVORITE,
    )
    const preferCross = opts.enabledTypes.includes(
      PushRecommendationCandidateType.CROSS_CUISINE_DISCOVERY,
    )
    const candidateType = preferReorder
      ? PushRecommendationCandidateType.REORDER_FAVORITE
      : preferCross
        ? PushRecommendationCandidateType.CROSS_CUISINE_DISCOVERY
        : opts.enabledTypes[0]!
    return {
      product: hit,
      candidateType,
      reasonTags: ['graph_product', `rank:${i}`],
      scoreBoost: Math.max(0, 12 - i),
    }
  }

  // 2. Boutique graphe → STORE_RETURN si produit du store dans le feed
  if (
    graphStores.size &&
    opts.enabledTypes.includes(PushRecommendationCandidateType.STORE_RETURN)
  ) {
    for (const p of products) {
      const storeRaw = p.store as Record<string, unknown> | undefined
      const sid = String(p.storeId ?? storeRaw?._id ?? storeRaw?.id ?? '').trim()
      if (sid && graphStores.has(sid)) {
        return {
          product: p,
          candidateType: PushRecommendationCandidateType.STORE_RETURN,
          reasonTags: ['graph_store'],
          scoreBoost: 8,
        }
      }
    }
  }

  return null
}
