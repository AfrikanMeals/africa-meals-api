import {
  courierAbandonConsequences,
  isCourierAbandonAfterStoreCollect,
} from './delivery-agent-abandon.util';

describe('delivery-agent-abandon.util', () => {
  it('isCourierAbandonAfterStoreCollect — false tant que non collecté', () => {
    expect(isCourierAbandonAfterStoreCollect(null)).toBe(false);
    expect(isCourierAbandonAfterStoreCollect(undefined)).toBe(false);
    expect(isCourierAbandonAfterStoreCollect('')).toBe(false);
  });

  it('isCourierAbandonAfterStoreCollect — true après collect', () => {
    expect(isCourierAbandonAfterStoreCollect(new Date())).toBe(true);
    expect(
      isCourierAbandonAfterStoreCollect('2026-08-24T12:00:00.000Z'),
    ).toBe(true);
  });

  it('courierAbandonConsequences — pré-collect : 1 abandon, pas de reset', () => {
    expect(courierAbandonConsequences(null)).toEqual({
      afterStoreCollect: false,
      unassignByCourierInc: 1,
      unassignAfterStoreCollectInc: 0,
      clearStoreCollected: false,
    });
  });

  it('courierAbandonConsequences — post-collect : score extra + reset collect', () => {
    expect(courierAbandonConsequences(new Date())).toEqual({
      afterStoreCollect: true,
      unassignByCourierInc: 1,
      unassignAfterStoreCollectInc: 1,
      clearStoreCollected: true,
    });
  });
});
