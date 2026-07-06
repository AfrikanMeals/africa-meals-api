import {
  PartnerBadgeCode,
  getPartnerBadgeDefinition,
  partnerBadgePayoutMethod,
  resolveEffectivePartnerBadgeCode,
} from './partner-badge.constants';

/**
 * Anti-régression : la décision « versement instantané vs calendrier » du
 * paiement livreur après transfer Connect (StripeConnectService
 * .settlePartnerBadgePayoutAfterTransfer) repose sur ces helpers purs.
 */
describe('partner badge payout method', () => {
  it('DIAMOND (0 jour) → versement instantané', () => {
    expect(partnerBadgePayoutMethod(PartnerBadgeCode.DIAMOND)).toBe('instant');
    expect(getPartnerBadgeDefinition(PartnerBadgeCode.DIAMOND)?.payoutDelayDays).toBe(
      0,
    );
  });

  it('GOLD → versement standard (calendrier automatique)', () => {
    expect(partnerBadgePayoutMethod(PartnerBadgeCode.GOLD)).toBe('standard');
    expect(
      getPartnerBadgeDefinition(PartnerBadgeCode.GOLD)?.payoutDelayDays ?? -1,
    ).toBeGreaterThan(0);
  });

  it('SILVER → versement standard (calendrier automatique)', () => {
    expect(partnerBadgePayoutMethod(PartnerBadgeCode.SILVER)).toBe('standard');
    expect(
      getPartnerBadgeDefinition(PartnerBadgeCode.SILVER)?.payoutDelayDays ?? -1,
    ).toBeGreaterThan(0);
  });

  it('badge inconnu / vide → SILVER par défaut (standard)', () => {
    expect(resolveEffectivePartnerBadgeCode(null)).toBe(PartnerBadgeCode.SILVER);
    expect(resolveEffectivePartnerBadgeCode('')).toBe(PartnerBadgeCode.SILVER);
    expect(resolveEffectivePartnerBadgeCode('PLATINUM')).toBe(
      PartnerBadgeCode.SILVER,
    );
    expect(partnerBadgePayoutMethod('PLATINUM')).toBe('standard');
  });
});
