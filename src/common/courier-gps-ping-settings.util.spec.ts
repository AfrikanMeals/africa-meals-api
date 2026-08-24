import {
  DEFAULT_COURIER_GPS_PING_SETTINGS,
  normalizeCourierGpsPingSettings,
  resolveCourierGpsWsThrottleMs,
  shouldSkipCourierGpsHttpReport,
} from './courier-gps-ping-settings.util';

describe('courier-gps-ping-settings.util', () => {
  it('fail-open defaults match historical 2s / 20s ping', () => {
    expect(normalizeCourierGpsPingSettings(undefined)).toEqual(
      DEFAULT_COURIER_GPS_PING_SETTINGS,
    );
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.intervalActiveMs).toBe(2_000);
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.intervalIdleMs).toBe(20_000);
  });

  it('clamps out-of-range intervals', () => {
    const normalized = normalizeCourierGpsPingSettings({
      enabled: true,
      intervalActiveMs: 50,
      intervalIdleMs: 999_999,
    });
    expect(normalized.intervalActiveMs).toBe(1_000);
    expect(normalized.intervalIdleMs).toBe(60_000);
  });

  it('disables only when enabled is explicitly false', () => {
    expect(normalizeCourierGpsPingSettings({}).enabled).toBe(true);
    expect(normalizeCourierGpsPingSettings({ enabled: false }).enabled).toBe(
      false,
    );
    expect(
      shouldSkipCourierGpsHttpReport(
        normalizeCourierGpsPingSettings({ enabled: false }),
      ),
    ).toBe(true);
    expect(
      shouldSkipCourierGpsHttpReport(DEFAULT_COURIER_GPS_PING_SETTINGS),
    ).toBe(false);
  });

  it('WS throttle follows active interval with 1s floor', () => {
    expect(
      resolveCourierGpsWsThrottleMs(
        { enabled: true, intervalActiveMs: 2_000, intervalIdleMs: 20_000 },
        3_000,
      ),
    ).toBe(2_000);
    expect(
      resolveCourierGpsWsThrottleMs(
        { enabled: true, intervalActiveMs: 500, intervalIdleMs: 20_000 },
        3_000,
      ),
    ).toBe(1_000);
    expect(
      resolveCourierGpsWsThrottleMs(
        { enabled: false, intervalActiveMs: 2_000, intervalIdleMs: 20_000 },
        3_000,
      ),
    ).toBe(3_000);
  });
});
