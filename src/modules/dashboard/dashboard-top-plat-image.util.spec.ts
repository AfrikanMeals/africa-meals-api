import { resolveTopPlatDisplayImageUrl } from './dashboard-top-plat-image.util';

describe('resolveTopPlatDisplayImageUrl', () => {
  it('priorise pictureUrl commande', () => {
    expect(
      resolveTopPlatDisplayImageUrl({
        orderPictureUrl: ' https://cdn.example/order.jpg ',
        catalogImageUrl: 'https://cdn.example/catalog.jpg',
      }),
    ).toBe('https://cdn.example/order.jpg');
  });

  it('repli catalogue si pas de photo commande', () => {
    expect(
      resolveTopPlatDisplayImageUrl({
        orderPictureUrl: null,
        catalogImageUrl: 'https://cdn.example/catalog.jpg',
      }),
    ).toBe('https://cdn.example/catalog.jpg');
  });

  it('undefined si rien', () => {
    expect(
      resolveTopPlatDisplayImageUrl({
        orderPictureUrl: '  ',
        catalogImageUrl: undefined,
      }),
    ).toBeUndefined();
  });
});
