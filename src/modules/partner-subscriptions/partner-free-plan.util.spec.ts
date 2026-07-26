import { pickDefaultPartnerFreePlan } from './partner-free-plan.util';

describe('partner-free-plan.util', () => {
  it('préfère le plan nommé FREE', () => {
    const picked = pickDefaultPartnerFreePlan([
      {
        name: 'Starter',
        priceMonthly: 0,
        priceYearly: 0,
        active: true,
      },
      {
        name: 'FREE',
        priceMonthly: 0,
        priceYearly: 0,
        active: true,
      },
    ]);
    expect(picked?.name).toBe('FREE');
  });

  it('ignore les plans inactifs', () => {
    const picked = pickDefaultPartnerFreePlan([
      {
        name: 'FREE',
        priceMonthly: 0,
        priceYearly: 0,
        active: false,
      },
      {
        name: 'Zero',
        priceMonthly: 0,
        priceYearly: 0,
        active: true,
      },
    ]);
    expect(picked?.name).toBe('Zero');
  });

  it('retourne null si aucun FREE', () => {
    expect(
      pickDefaultPartnerFreePlan([
        { name: 'PRO', priceMonthly: 29, priceYearly: 290, active: true },
      ]),
    ).toBeNull();
  });
});
