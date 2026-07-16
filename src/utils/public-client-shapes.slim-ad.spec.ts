import { slimAdForPublicClient } from './public-client-shapes';

describe('slimAdForPublicClient', () => {
  it('expose productBundleId depuis ref peuplée (action BUNDLE)', () => {
    const slim = slimAdForPublicClient({
      _id: '507f1f77bcf86cd799439011',
      title: 'Opening',
      subtitle: 'Sub',
      actionText: 'Voir',
      actionType: 'BUNDLE',
      productBundle: {
        _id: '507f1f77bcf86cd799439099',
        nameFr: 'Eru + Jus',
      },
      store: { _id: '507f1f77bcf86cd799439022', name: 'Resto' },
    });
    expect(slim.actionType).toBe('BUNDLE');
    expect(slim.productBundleId).toBe('507f1f77bcf86cd799439099');
    expect(slim.storeId).toBe('507f1f77bcf86cd799439022');
  });

  it('expose productBundleId plat', () => {
    const slim = slimAdForPublicClient({
      _id: '507f1f77bcf86cd799439011',
      title: 'Opening',
      subtitle: '',
      actionText: 'Go',
      actionType: 'BUNDLE',
      productBundleId: '507f1f77bcf86cd799439088',
    });
    expect(slim.productBundleId).toBe('507f1f77bcf86cd799439088');
  });
});
