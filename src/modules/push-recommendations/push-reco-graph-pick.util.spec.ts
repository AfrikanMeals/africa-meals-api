import { PushRecommendationCandidateType } from '@schemas/push-recommendation-candidate.schema'
import { pickPushCandidateFromGraph } from './push-reco-graph-pick.util'

describe('pickPushCandidateFromGraph', () => {
  const feed = [
    { _id: 'p1', title: 'A', storeId: 's1' },
    { _id: 'p2', title: 'B', storeId: 's2' },
  ]

  it('retourne null sans match graphe', () => {
    expect(
      pickPushCandidateFromGraph({
        enabledTypes: [PushRecommendationCandidateType.REORDER_FAVORITE],
        feedProducts: feed,
        graphProductIds: ['px'],
        graphStoreIds: [],
      }),
    ).toBeNull()
  })

  it('priorise produit graphe en REORDER_FAVORITE', () => {
    const pick = pickPushCandidateFromGraph({
      enabledTypes: [
        PushRecommendationCandidateType.CROSS_CUISINE_DISCOVERY,
        PushRecommendationCandidateType.REORDER_FAVORITE,
      ],
      feedProducts: feed,
      graphProductIds: ['p2'],
      graphStoreIds: [],
    })
    expect(pick?.product._id).toBe('p2')
    expect(pick?.candidateType).toBe(
      PushRecommendationCandidateType.REORDER_FAVORITE,
    )
    expect(pick?.reasonTags).toContain('graph_product')
  })

  it('fallback STORE_RETURN via boutique graphe', () => {
    const pick = pickPushCandidateFromGraph({
      enabledTypes: [PushRecommendationCandidateType.STORE_RETURN],
      feedProducts: feed,
      graphProductIds: [],
      graphStoreIds: ['s2'],
    })
    expect(pick?.product._id).toBe('p2')
    expect(pick?.candidateType).toBe(
      PushRecommendationCandidateType.STORE_RETURN,
    )
  })
})
