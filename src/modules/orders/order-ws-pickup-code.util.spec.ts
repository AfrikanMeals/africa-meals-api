import { readOrderPickupCodeForWs } from './order-ws-pickup-code.util';

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
