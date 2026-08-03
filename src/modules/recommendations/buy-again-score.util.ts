/**
 * Scoring Buy Again — produits déjà commandés, classés par intérêt.
 * Formule pure (testable) : récence + fréquence + dépense + boosts intérêt.
 */

/** Demi-vie récence (~45 jours) pour la décroissance exponentielle. */
export const BUY_AGAIN_RECENCY_HALF_LIFE_DAYS = 45

/** Poids par défaut du score Buy Again. */
export const DEFAULT_BUY_AGAIN_WEIGHTS = {
  /** Coefficient sur exp(-λ·jours). */
  recency: 1.0,
  /** Coefficient sur log1p(orderCount). */
  frequency: 0.85,
  /** Coefficient sur log1p(totalSpent). */
  spend: 0.35,
  /** Boost si produit favori. */
  favorite: 0.45,
  /** Boost si produit vu récemment (signaux). */
  viewed: 0.25,
  /** Boost si produit noté par l’utilisateur. */
  rated: 0.2,
} as const

export type BuyAgainWeights = {
  recency: number
  frequency: number
  spend: number
  favorite: number
  viewed: number
  rated: number
}

/** Candidat brut (Neo4j `:ORDERED` ou agrégat Mongo). */
export type BuyAgainCandidate = {
  productId: string
  orderCount: number
  /** ISO date ou Date — dernière commande. */
  lastAt: string | Date | null | undefined
  totalSpent?: number | null
}

export type BuyAgainInterestFlags = {
  favorite?: boolean
  viewed?: boolean
  rated?: boolean
}

/**
 * Score d’un candidat Buy Again à l’instant `now`.
 * Retourne -Infinity si productId vide (exclu du tri).
 */
export function scoreBuyAgainCandidate(
  candidate: BuyAgainCandidate,
  interest: BuyAgainInterestFlags = {},
  now: Date = new Date(),
  weights: BuyAgainWeights = DEFAULT_BUY_AGAIN_WEIGHTS,
): number {
  const productId = String(candidate.productId ?? '').trim()
  if (!productId) return Number.NEGATIVE_INFINITY

  const orderCount = Math.max(0, Number(candidate.orderCount) || 0)
  const totalSpent = Math.max(0, Number(candidate.totalSpent) || 0)

  // 1. Récence : décroissance exponentielle (demi-vie ~45 j)
  const lastMs = _parseLastAtMs(candidate.lastAt)
  let recencyScore = 0
  if (lastMs != null) {
    const days = Math.max(0, (now.getTime() - lastMs) / 86_400_000)
    const lambda = Math.LN2 / BUY_AGAIN_RECENCY_HALF_LIFE_DAYS
    recencyScore = Math.exp(-lambda * days)
  }

  // 2. Fréquence + 3. dépense (log pour éviter dominance des gros volumes)
  const frequencyScore = Math.log1p(orderCount)
  const spendScore = Math.log1p(totalSpent)

  let score =
    weights.recency * recencyScore +
    weights.frequency * frequencyScore +
    weights.spend * spendScore

  // 4. Intérêt explicite (favori / vu / noté)
  if (interest.favorite) score += weights.favorite
  if (interest.viewed) score += weights.viewed
  if (interest.rated) score += weights.rated

  return score
}

/**
 * Quand basculer Buy Again vers l’agrégat Mongo.
 * Fix: Neo4j healthy + `[]` (pas d’arêtes `:ORDERED` / sync incomplet) bloquait
 * le fallback — section Home absente malgré des commandes Mongo.
 */
export function shouldUseMongoBuyAgainFallback(
  neoCandidates: BuyAgainCandidate[] | null | undefined,
): boolean {
  return neoCandidates == null || neoCandidates.length === 0
}

/**
 * Trie les candidats par score DESC, tie-break lastAt DESC, déduplique, borne `limit`.
 */
export function rankBuyAgainCandidates(
  candidates: BuyAgainCandidate[],
  interestByProductId: Map<string, BuyAgainInterestFlags> | undefined,
  limit: number,
  now: Date = new Date(),
  weights: BuyAgainWeights = DEFAULT_BUY_AGAIN_WEIGHTS,
): string[] {
  const take = Math.min(48, Math.max(1, Math.floor(limit) || 12))
  const scored: Array<{
    productId: string
    score: number
    lastMs: number
  }> = []
  const seen = new Set<string>()

  for (const c of candidates) {
    const productId = String(c.productId ?? '').trim()
    if (!productId || seen.has(productId)) continue
    seen.add(productId)
    const interest = interestByProductId?.get(productId) ?? {}
    const score = scoreBuyAgainCandidate(c, interest, now, weights)
    if (!Number.isFinite(score)) continue
    scored.push({
      productId,
      score,
      lastMs: _parseLastAtMs(c.lastAt) ?? 0,
    })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.lastMs - a.lastMs
  })

  return scored.slice(0, take).map((x) => x.productId)
}

function _parseLastAtMs(
  lastAt: string | Date | null | undefined,
): number | null {
  if (lastAt == null || lastAt === '') return null
  if (lastAt instanceof Date) {
    const t = lastAt.getTime()
    return Number.isFinite(t) ? t : null
  }
  const t = Date.parse(String(lastAt))
  return Number.isNaN(t) ? null : t
}
