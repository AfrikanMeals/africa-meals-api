import {
  allocateDeliveryTipCents,
  maxDeliveryTipCentsForGoodsSubtotal,
} from './delivery-tip-allocation.util';

describe('allocateDeliveryTipCents', () => {
  it('returns zero when tip is zero', () => {
    const out = allocateDeliveryTipCents({
      tipTotalCents: 0,
      legs: [
        { storeId: 'b', shipCents: 500 },
        { storeId: 'a', shipCents: 1000 },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.allocatedTipCents === 0)).toBe(true);
  });

  it('splits proportionally to shipping fees', () => {
    const out = allocateDeliveryTipCents({
      tipTotalCents: 1200,
      legs: [
        { storeId: 'b', shipCents: 500 },
        { storeId: 'a', shipCents: 1000 },
      ],
    });
    const sum = out.reduce((a, r) => a + r.allocatedTipCents, 0);
    expect(sum).toBe(1200);
    const a = out.find((r) => r.storeId === 'a');
    const b = out.find((r) => r.storeId === 'b');
    expect(a?.allocatedTipCents).toBe(800);
    expect(b?.allocatedTipCents).toBe(400);
  });

  it('splits equally when all shipping fees are zero', () => {
    const out = allocateDeliveryTipCents({
      tipTotalCents: 100,
      legs: [
        { storeId: 'a', shipCents: 0 },
        { storeId: 'b', shipCents: 0 },
      ],
    });
    expect(out.reduce((a, r) => a + r.allocatedTipCents, 0)).toBe(100);
  });
});

describe('maxDeliveryTipCentsForGoodsSubtotal', () => {
  it('caps at 50%', () => {
    expect(maxDeliveryTipCentsForGoodsSubtotal(10000)).toBe(5000);
  });
});
