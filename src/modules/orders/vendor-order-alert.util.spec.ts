import {
  isVendorOrderAlertStillRinging,
  shouldSendVendorOrderAlertReminder,
  vendorOrderAlertCollapseKey,
  VENDOR_ORDER_ALERT_MAX_REMINDERS,
  VENDOR_ORDER_ALERT_REMIND_INTERVAL_MS,
} from './vendor-order-alert.util';

describe('vendor-order-alert.util', () => {
  it('ringing tant que paied sans vendorAcceptedAt', () => {
    expect(isVendorOrderAlertStillRinging({ status: 'paied' })).toBe(true);
    expect(
      isVendorOrderAlertStillRinging({
        status: 'awaiting_cash',
        vendorAcceptedAt: null,
      }),
    ).toBe(true);
  });

  it('stop si accepté ou statut hors workflow', () => {
    expect(
      isVendorOrderAlertStillRinging({
        status: 'paied',
        vendorAcceptedAt: new Date(),
      }),
    ).toBe(false);
    expect(isVendorOrderAlertStillRinging({ status: 'cancelled' })).toBe(
      false,
    );
    expect(isVendorOrderAlertStillRinging({ status: 'approved' })).toBe(false);
  });

  it('rappel throttle + cap', () => {
    const now = 1_000_000;
    expect(
      shouldSendVendorOrderAlertReminder({
        nowMs: now,
        lastRemindedAtMs: null,
        remindCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldSendVendorOrderAlertReminder({
        nowMs: now,
        lastRemindedAtMs: now - 10_000,
        remindCount: 1,
        intervalMs: VENDOR_ORDER_ALERT_REMIND_INTERVAL_MS,
      }),
    ).toBe(false);
    expect(
      shouldSendVendorOrderAlertReminder({
        nowMs: now,
        lastRemindedAtMs: now - VENDOR_ORDER_ALERT_REMIND_INTERVAL_MS,
        remindCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldSendVendorOrderAlertReminder({
        nowMs: now,
        lastRemindedAtMs: null,
        remindCount: VENDOR_ORDER_ALERT_MAX_REMINDERS,
      }),
    ).toBe(false);
  });

  it('collapse key stable', () => {
    expect(vendorOrderAlertCollapseKey(' abc ')).toBe('vendor-alert-abc');
  });
});
