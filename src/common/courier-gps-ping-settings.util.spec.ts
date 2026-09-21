import {
  DEFAULT_COURIER_GPS_PING_SETTINGS,
  courierMapRealtimePreset,
  matchCourierMapRealtimePreset,
  normalizeCourierGpsPingSettings,
  normalizeCourierGpsTrail,
  resolveCourierGpsWsThrottleMs,
  shouldSkipCourierGpsForAccuracy,
  shouldSkipCourierGpsHttpReport,
} from './courier-gps-ping-settings.util';

describe('courier-gps-ping-settings.util', () => {
  it('fail-open defaults match historical 2s / 20s ping without stream', () => {
    expect(normalizeCourierGpsPingSettings(undefined)).toEqual(
      DEFAULT_COURIER_GPS_PING_SETTINGS,
    );
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.intervalActiveMs).toBe(2_000);
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.intervalIdleMs).toBe(20_000);
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.streamCoordinates).toBe(false);
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.syncStatusAndState).toBe(false);
    expect(DEFAULT_COURIER_GPS_PING_SETTINGS.profile).toBe('custom');
  });

  it('clamps out-of-range intervals and stream knobs', () => {
    const normalized = normalizeCourierGpsPingSettings({
      enabled: true,
      intervalActiveMs: 50,
      intervalIdleMs: 999_999,
      streamSampleMs: 10,
      streamMaxPoints: 99,
      maxAccuracyMeters: 500,
    });
    expect(normalized.intervalActiveMs).toBe(1_000);
    expect(normalized.intervalIdleMs).toBe(60_000);
    expect(normalized.streamSampleMs).toBe(250);
    expect(normalized.streamMaxPoints).toBe(12);
    expect(normalized.maxAccuracyMeters).toBe(100);
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

  it('stream and status sync are opt-in', () => {
    expect(normalizeCourierGpsPingSettings({}).streamCoordinates).toBe(false);
    expect(normalizeCourierGpsPingSettings({}).syncStatusAndState).toBe(false);
    expect(
      normalizeCourierGpsPingSettings({
        streamCoordinates: true,
        syncStatusAndState: true,
      }).streamCoordinates,
    ).toBe(true);
  });

  it('skips inaccurate samples only when filter is on', () => {
    const ping = normalizeCourierGpsPingSettings({ maxAccuracyMeters: 20 });
    expect(shouldSkipCourierGpsForAccuracy(ping, 35)).toBe(true);
    expect(shouldSkipCourierGpsForAccuracy(ping, 10)).toBe(false);
    expect(shouldSkipCourierGpsForAccuracy(ping, null)).toBe(false);
    expect(
      shouldSkipCourierGpsForAccuracy(DEFAULT_COURIER_GPS_PING_SETTINGS, 80),
    ).toBe(false);
  });

  it('WS throttle follows active interval with 1s floor', () => {
    expect(
      resolveCourierGpsWsThrottleMs(
        normalizeCourierGpsPingSettings({
          intervalActiveMs: 2_000,
          intervalIdleMs: 20_000,
        }),
        3_000,
      ),
    ).toBe(2_000);
    expect(
      resolveCourierGpsWsThrottleMs(
        normalizeCourierGpsPingSettings({ intervalActiveMs: 500 }),
        3_000,
      ),
    ).toBe(1_000);
    expect(
      resolveCourierGpsWsThrottleMs(
        normalizeCourierGpsPingSettings({ enabled: false }),
        3_000,
      ),
    ).toBe(3_000);
  });

  it('presets fill streaming + status sync and match detection', () => {
    const optimal = courierMapRealtimePreset('optimal');
    expect(optimal.ping.streamCoordinates).toBe(true);
    expect(optimal.ping.syncStatusAndState).toBe(true);
    expect(optimal.ping.intervalActiveMs).toBe(2_000);
    expect(
      matchCourierMapRealtimePreset(optimal.ping, optimal.routing),
    ).toBe('optimal');
    expect(
      matchCourierMapRealtimePreset(
        courierMapRealtimePreset('precise').ping,
      ),
    ).toBe('precise');
    expect(
      matchCourierMapRealtimePreset(DEFAULT_COURIER_GPS_PING_SETTINGS),
    ).toBe('custom');
  });

  it('sanitizes GPS trail and drops invalid points', () => {
    const trail = normalizeCourierGpsTrail(
      [
        { latitude: 4.05, longitude: 9.7, recordedAt: '2026-09-21T10:00:00.000Z' },
        { latitude: 99, longitude: 0 },
        { latitude: 4.06, longitude: 9.71 },
      ],
      8,
    );
    expect(trail).toHaveLength(2);
    expect(trail[0].latitude).toBe(4.05);
    expect(trail[1].longitude).toBe(9.71);
  });
});
