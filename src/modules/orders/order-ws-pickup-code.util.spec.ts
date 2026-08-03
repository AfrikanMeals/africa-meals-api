import {
  readOrderPickupCodeForWs,
  stripPickupCodeFromWsPayload,
} from './order-ws-pickup-code.util';

describe('readOrderPickupCodeForWs', () => {
  it('retourne le code normalisé si ≥ 4 chars', () => {
    expect(readOrderPickupCodeForWs({ pickupCode: 'ab12' })).toBe('AB12');
    expect(readOrderPickupCodeForWs({ pickup_code: ' XYZ9 ' })).toBe('XYZ9');
  });

  it('ignore codes trop courts ou absents', () => {
    expect(readOrderPickupCodeForWs({ pickupCode: 'AB' })).toBeUndefined();
    expect(readOrderPickupCodeForWs({})).toBeUndefined();
    expect(readOrderPickupCodeForWs({ pickupCode: '' })).toBeUndefined();
  });
});

describe('stripPickupCodeFromWsPayload', () => {
  it('retire pickupCode / pickup_code sans muter l’original', () => {
    const src = { orderId: 'o1', pickupCode: 'AB12CD', status: 'approved' };
    const out = stripPickupCodeFromWsPayload(src);
    expect(out.pickupCode).toBeUndefined();
    expect(out).toEqual({ orderId: 'o1', status: 'approved' });
    expect(src.pickupCode).toBe('AB12CD');
  });

  it('no-op si aucun code', () => {
    const src = { orderId: 'o1', status: 'shipped' };
    expect(stripPickupCodeFromWsPayload(src)).toBe(src);
  });
});
