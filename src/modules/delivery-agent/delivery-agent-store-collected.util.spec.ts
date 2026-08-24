import {
  canConfirmStoreCollected,
  isOrderAbandonableAfterStoreCollect,
  parseStoreCollectedAt,
  storeCollectedAtIso,
} from './delivery-agent-store-collected.util';

describe('delivery-agent-store-collected.util', () => {
  const base = {
    shouldShip: true,
    status: 'shipped',
    assignedDeliveryUserId: 'agent-1',
    storeCollectedAt: null as Date | string | null,
  };

  it('parseStoreCollectedAt accepte Date et ISO', () => {
    const d = new Date('2026-08-24T12:00:00.000Z');
    expect(parseStoreCollectedAt(d)?.toISOString()).toBe(d.toISOString());
    expect(parseStoreCollectedAt(d.toISOString())?.toISOString()).toBe(
      d.toISOString(),
    );
    expect(parseStoreCollectedAt(null)).toBeNull();
    expect(parseStoreCollectedAt('')).toBeNull();
  });

  it('canConfirmStoreCollected — happy path puis refus après collect', () => {
    expect(canConfirmStoreCollected(base, 'agent-1')).toBe(true);
    expect(
      canConfirmStoreCollected(
        { ...base, storeCollectedAt: new Date() },
        'agent-1',
      ),
    ).toBe(false);
  });

  it('canConfirmStoreCollected — refuse hors shipped / hors assignee / pickup', () => {
    expect(canConfirmStoreCollected({ ...base, status: 'approved' }, 'agent-1')).toBe(
      false,
    );
    expect(canConfirmStoreCollected(base, 'other')).toBe(false);
    expect(
      canConfirmStoreCollected({ ...base, shouldShip: false }, 'agent-1'),
    ).toBe(false);
  });

  it('isOrderAbandonableAfterStoreCollect — autorisé avant et après collect', () => {
    expect(isOrderAbandonableAfterStoreCollect(null)).toBe(true);
    expect(isOrderAbandonableAfterStoreCollect(new Date())).toBe(true);
  });

  it('storeCollectedAtIso', () => {
    expect(storeCollectedAtIso(null)).toBeNull();
    expect(storeCollectedAtIso('2026-08-24T10:00:00.000Z')).toBe(
      '2026-08-24T10:00:00.000Z',
    );
  });
});
