import {
  parsePartnerEarningOrderId,
  pickPlatformAvailableMinor,
  resolvePartnerEarningTransferSpec,
} from './partner-earning-transfer-amount.util';

describe('pickPlatformAvailableMinor', () => {
  it('trouve la devise demandée', () => {
    expect(
      pickPlatformAvailableMinor(
        [
          { currency: 'cad', amountMinor: 43780 },
          { currency: 'xaf', amountMinor: 500 },
        ],
        'XAF',
      ),
    ).toBe(500);
  });
});

describe('parsePartnerEarningOrderId', () => {
  it('extrait ObjectId avant le premier :', () => {
    expect(
      parsePartnerEarningOrderId('6a67d4316a9e80d6cf464d65:vendor_sales'),
    ).toBe('6a67d4316a9e80d6cf464d65');
  });

  it('rejette un id invalide', () => {
    expect(parsePartnerEarningOrderId('not-an-id:vendor_sales')).toBeNull();
  });
});

describe('resolvePartnerEarningTransferSpec', () => {
  const cadBal = [{ currency: 'cad', amountMinor: 43780 }];

  it('reste en ledger si solde XAF suffisant', () => {
    const spec = resolvePartnerEarningTransferSpec({
      ledgerAmountMajor: 211,
      ledgerCurrency: 'XAF',
      platformAvailable: [
        { currency: 'xaf', amountMinor: 1000 },
        ...cadBal,
      ],
      settlementCurrency: 'CAD',
      ledgerToSettlementRate: 0.002,
    });
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.mode).toBe('ledger');
    expect(spec.currency).toBe('xaf');
    expect(spec.amountMinor).toBe(211);
  });

  it('convertit XAF → CAD via FX si pas de solde XAF', () => {
    // 211 XAF × 0.225 ≈ 47 CAD cents (taux type charge→BT).
    const rate = 0.225;
    const spec = resolvePartnerEarningTransferSpec({
      ledgerAmountMajor: 211,
      ledgerCurrency: 'XAF',
      platformAvailable: cadBal,
      settlementCurrency: 'CAD',
      ledgerToSettlementRate: rate,
    });
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.mode).toBe('settlement_fx');
    expect(spec.currency).toBe('cad');
    expect(spec.amountMinor).toBe(Math.round(211 * rate));
  });

  it('échoue sans taux FX si devises différentes', () => {
    const spec = resolvePartnerEarningTransferSpec({
      ledgerAmountMajor: 211,
      ledgerCurrency: 'XAF',
      platformAvailable: cadBal,
      settlementCurrency: 'CAD',
      ledgerToSettlementRate: null,
    });
    expect(spec.ok).toBe(false);
    if (spec.ok === false) {
      expect(spec.reason).toBe('partner_earning_fx_required');
    }
  });

  it('échoue si solde CAD insuffisant après FX', () => {
    const spec = resolvePartnerEarningTransferSpec({
      ledgerAmountMajor: 211,
      ledgerCurrency: 'XAF',
      platformAvailable: [{ currency: 'cad', amountMinor: 1 }],
      settlementCurrency: 'CAD',
      ledgerToSettlementRate: 0.225,
    });
    expect(spec.ok).toBe(false);
    if (spec.ok === false) {
      expect(spec.reason).toBe('partner_earning_insufficient_settlement');
    }
  });

  it('refuse rate=1 entre devises différentes', () => {
    const spec = resolvePartnerEarningTransferSpec({
      ledgerAmountMajor: 211,
      ledgerCurrency: 'XAF',
      platformAvailable: cadBal,
      settlementCurrency: 'CAD',
      ledgerToSettlementRate: 1,
    });
    expect(spec.ok).toBe(false);
    if (spec.ok === false) {
      expect(spec.reason).toBe('partner_earning_fx_required');
    }
  });
});
