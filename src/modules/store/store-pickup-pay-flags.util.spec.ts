import {
  docAcceptsPickupPayOnDelivery,
  docDefaultPickupPayOnPickup,
  normalizeDefaultPickupPayOnPickupFlag,
} from './store-pickup-pay-flags.util';

describe('store-pickup-pay-flags.util', () => {
  describe('docDefaultPickupPayOnPickup', () => {
    it('retourne false si le champ n’est pas dans le doc (bug select omis)', () => {
      // Régression : résumé vendeur sans defaultPickupPayOnPickup dans .select()
      expect(
        docDefaultPickupPayOnPickup({
          acceptsPickupPayOnDelivery: true,
        }),
      ).toBe(false);
    });

    it('retourne true quand accepts + default sont true', () => {
      expect(
        docDefaultPickupPayOnPickup({
          acceptsPickupPayOnDelivery: true,
          defaultPickupPayOnPickup: true,
        }),
      ).toBe(true);
    });

    it('retourne false si accepts est off même si default true', () => {
      expect(
        docDefaultPickupPayOnPickup({
          acceptsPickupPayOnDelivery: false,
          defaultPickupPayOnPickup: true,
        }),
      ).toBe(false);
    });

    it('lit snake_case Mongo', () => {
      expect(
        docDefaultPickupPayOnPickup({
          accepts_pickup_pay_on_delivery: true,
          default_pickup_pay_on_pickup: true,
        }),
      ).toBe(true);
    });
  });

  describe('normalizeDefaultPickupPayOnPickupFlag', () => {
    it('force false si paiement collecte désactivé', () => {
      expect(normalizeDefaultPickupPayOnPickupFlag(true, false)).toBe(false);
    });

    it('conserve true si collecte active', () => {
      expect(normalizeDefaultPickupPayOnPickupFlag(true, true)).toBe(true);
    });
  });

  describe('docAcceptsPickupPayOnDelivery', () => {
    it('accepte camelCase et snake_case', () => {
      expect(
        docAcceptsPickupPayOnDelivery({ acceptsPickupPayOnDelivery: true }),
      ).toBe(true);
      expect(
        docAcceptsPickupPayOnDelivery({
          accepts_pickup_pay_on_delivery: true,
        }),
      ).toBe(true);
      expect(docAcceptsPickupPayOnDelivery({})).toBe(false);
    });
  });
});
