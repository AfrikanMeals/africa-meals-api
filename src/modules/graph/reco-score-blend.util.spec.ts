import {
  adsGraphSoftBoost,
  blendRecoScores,
  DEFAULT_RECO_BLEND_WEIGHTS,
  graphRankById,
  mergeGraphIdLists,
  prioritizeStoreIdsByZone,
} from './reco-score-blend.util'

describe('reco-score-blend.util', () => {
  it('graphRankById ignore vides et doublons', () => {
    const m = graphRankById(['a', '', 'b', 'a', 'c'])
    expect(m.get('a')).toBe(0)
    expect(m.get('b')).toBe(1)
    expect(m.get('c')).toBe(2)
    expect(m.size).toBe(3)
  })

  it('blendRecoScores sans rang = mongo seul', () => {
    expect(blendRecoScores(1.5, undefined)).toBe(1.5)
    expect(blendRecoScores(1.5, -1)).toBe(1.5)
  })

  it('blendRecoScores décroît avec le rang', () => {
    const s0 = blendRecoScores(1, 0, DEFAULT_RECO_BLEND_WEIGHTS)
    const s1 = blendRecoScores(1, 1, DEFAULT_RECO_BLEND_WEIGHTS)
    expect(s0).toBeCloseTo(1 + 0.35)
    expect(s1).toBeLessThan(s0)
    expect(s1).toBeGreaterThan(1)
  })

  it('mergeGraphIdLists déduplique et borne', () => {
    expect(mergeGraphIdLists([['a', 'b'], ['b', 'c']], 2)).toEqual(['a', 'b'])
    expect(mergeGraphIdLists([['x'], null, ['y']], 10)).toEqual(['x', 'y'])
  })

  it('adsGraphSoftBoost ajoute bonus store/product', () => {
    const stores = new Set(['s1'])
    const products = new Set(['p1'])
    expect(
      adsGraphSoftBoost({
        mongoScore: 1,
        storeId: 's1',
        productId: 'p9',
        graphStoreIds: stores,
        graphProductIds: products,
        bonus: 0.1,
      }),
    ).toBeCloseTo(1.1)
    expect(
      adsGraphSoftBoost({
        mongoScore: 1,
        storeId: 's1',
        productId: 'p1',
        graphStoreIds: stores,
        graphProductIds: products,
        bonus: 0.1,
      }),
    ).toBeCloseTo(1.2)
  })

  it('prioritizeStoreIdsByZone place la zone en tête', () => {
    expect(prioritizeStoreIdsByZone(['a', 'b', 'c'], ['c', 'd'], 4)).toEqual([
      'c',
      'd',
      'a',
      'b',
    ])
  })
})
