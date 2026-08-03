import {
  BUY_AGAIN_RECENCY_HALF_LIFE_DAYS,
  rankBuyAgainCandidates,
  scoreBuyAgainCandidate,
  shouldUseMongoBuyAgainFallback,
} from './buy-again-score.util'

describe('buy-again-score.util', () => {
  const now = new Date('2026-08-01T12:00:00.000Z')

  it('ignore productId vide', () => {
    expect(
      scoreBuyAgainCandidate(
        { productId: '', orderCount: 3, lastAt: now },
        {},
        now,
      ),
    ).toBe(Number.NEGATIVE_INFINITY)
  })

  it('récence : commande récente score plus haut qu’ancienne', () => {
    const recent = scoreBuyAgainCandidate(
      {
        productId: 'a',
        orderCount: 1,
        lastAt: '2026-07-25T12:00:00.000Z',
        totalSpent: 10,
      },
      {},
      now,
    )
    const old = scoreBuyAgainCandidate(
      {
        productId: 'b',
        orderCount: 1,
        lastAt: '2025-01-01T12:00:00.000Z',
        totalSpent: 10,
      },
      {},
      now,
    )
    expect(recent).toBeGreaterThan(old)
  })

  it('fréquence : plus de commandes augmente le score', () => {
    const once = scoreBuyAgainCandidate(
      {
        productId: 'a',
        orderCount: 1,
        lastAt: now.toISOString(),
        totalSpent: 0,
      },
      {},
      now,
    )
    const often = scoreBuyAgainCandidate(
      {
        productId: 'b',
        orderCount: 8,
        lastAt: now.toISOString(),
        totalSpent: 0,
      },
      {},
      now,
    )
    expect(often).toBeGreaterThan(once)
  })

  it('intérêt favori / vu / noté ajoute des boosts', () => {
    const base = scoreBuyAgainCandidate(
      {
        productId: 'a',
        orderCount: 2,
        lastAt: now.toISOString(),
        totalSpent: 5,
      },
      {},
      now,
    )
    const boosted = scoreBuyAgainCandidate(
      {
        productId: 'a',
        orderCount: 2,
        lastAt: now.toISOString(),
        totalSpent: 5,
      },
      { favorite: true, viewed: true, rated: true },
      now,
    )
    expect(boosted).toBeGreaterThan(base)
  })

  it('rankBuyAgainCandidates trie, déduplique et borne', () => {
    // Même volume d’achats : le boost favori + récence place « fav » en tête.
    const interest = new Map([
      ['fav', { favorite: true as const }],
    ])
    const ids = rankBuyAgainCandidates(
      [
        {
          productId: 'old',
          orderCount: 2,
          lastAt: '2024-01-01T00:00:00.000Z',
          totalSpent: 20,
        },
        {
          productId: 'fav',
          orderCount: 2,
          lastAt: '2026-07-28T00:00:00.000Z',
          totalSpent: 20,
        },
        // Doublon ignoré (première occurrence conservée pour stats)
        {
          productId: 'fav',
          orderCount: 99,
          lastAt: '2026-07-01T00:00:00.000Z',
        },
        {
          productId: 'mid',
          orderCount: 2,
          lastAt: '2026-06-01T00:00:00.000Z',
          totalSpent: 20,
        },
      ],
      interest,
      2,
      now,
    )
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('fav')
    expect(ids).not.toContain('old')
  })

  it('demi-vie documentée > 0', () => {
    expect(BUY_AGAIN_RECENCY_HALF_LIFE_DAYS).toBe(45)
  })

  // Fix Home Buy Again : Neo4j [] ne doit pas masquer l’historique Mongo.
  it('shouldUseMongoBuyAgainFallback si null ou vide', () => {
    expect(shouldUseMongoBuyAgainFallback(null)).toBe(true)
    expect(shouldUseMongoBuyAgainFallback(undefined)).toBe(true)
    expect(shouldUseMongoBuyAgainFallback([])).toBe(true)
    expect(
      shouldUseMongoBuyAgainFallback([
        {
          productId: 'p1',
          orderCount: 1,
          lastAt: '2026-08-01T00:00:00.000Z',
        },
      ]),
    ).toBe(false)
  })
})
