import {
  isCustomerDeliveryChannelAllowed,
  isShippingDeliveryCategoryEnabled,
} from './customer-delivery-notify-channels.util';

describe('customer-delivery-notify-channels.util', () => {
  it('sans prefs → allow (legacy)', () => {
    expect(isShippingDeliveryCategoryEnabled(undefined)).toBe(true);
    expect(isCustomerDeliveryChannelAllowed(undefined, 'push')).toBe(true);
    expect(isCustomerDeliveryChannelAllowed(undefined, 'email')).toBe(true);
  });

  it('shippingDeliveryEnabled false → bloque push et email', () => {
    const prefs = {
      shippingDeliveryEnabled: false,
      pushEnabled: true,
      emailAlertsEnabled: true,
    };
    expect(isCustomerDeliveryChannelAllowed(prefs, 'push')).toBe(false);
    expect(isCustomerDeliveryChannelAllowed(prefs, 'email')).toBe(false);
  });

  it('respecte pushEnabled / emailAlertsEnabled indépendamment', () => {
    const prefs = {
      shippingDeliveryEnabled: true,
      pushEnabled: true,
      emailAlertsEnabled: false,
    };
    expect(isCustomerDeliveryChannelAllowed(prefs, 'push')).toBe(true);
    expect(isCustomerDeliveryChannelAllowed(prefs, 'email')).toBe(false);
  });

  it('push désactivé + email activé → email seul', () => {
    const prefs = {
      shippingDeliveryEnabled: true,
      pushEnabled: false,
      emailAlertsEnabled: true,
    };
    expect(isCustomerDeliveryChannelAllowed(prefs, 'push')).toBe(false);
    expect(isCustomerDeliveryChannelAllowed(prefs, 'email')).toBe(true);
  });
});
