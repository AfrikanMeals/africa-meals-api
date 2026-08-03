import { mapRecoFeedDrink } from './map-reco-feed-drink.util'

describe('mapRecoFeedDrink', () => {
  it('propage discountPrice quand promo valide', () => {
    const row = mapRecoFeedDrink({
      drink: {
        id: 'd1',
        name: "Jus d'ananas",
        priceCad: 500,
        discountPrice: 300,
        imageUrl: 'https://x/a.jpg',
        storeId: 's1',
        quantite: 10,
      },
      storeName: 'Wise',
    })
    expect(row.priceCad).toBe(500)
    expect(row.discountPrice).toBe(300)
    expect(row.storeName).toBe('Wise')
  })

  it('discountPrice = 0 si promo invalide (≥ priceCad)', () => {
    const row = mapRecoFeedDrink({
      drink: {
        id: 'd2',
        name: 'Eau',
        priceCad: 200,
        discountPrice: 200,
        storeId: 's1',
      },
    })
    expect(row.discountPrice).toBe(0)
  })
})
