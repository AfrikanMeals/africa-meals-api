import {
  courierTelemetryWsFields,
  normalizeCourierLiveTelemetry,
  type CourierLiveTelemetry,
} from './courier-live-telemetry.util';

describe('courier-live-telemetry.util', () => {
  it('normalise heading/speed/battery', () => {
    const t = normalizeCourierLiveTelemetry({
      headingDegrees: 90,
      speedMps: 5,
      batteryPercent: 55.7,
      recordedAt: '2026-07-14T00:00:00.000Z',
    });
    expect(t.headingDegrees).toBe(90);
    expect(t.speedMps).toBe(5);
    expect(t.batteryPercent).toBe(56);
    expect(t.recordedAt).toBe('2026-07-14T00:00:00.000Z');
  });

  it('rejette valeurs hors bornes', () => {
    const t = normalizeCourierLiveTelemetry({
      headingDegrees: 400,
      speedMps: -1,
      batteryPercent: 120,
    });
    expect(t.headingDegrees).toBeNull();
    expect(t.speedMps).toBeNull();
    expect(t.batteryPercent).toBeNull();
  });

  it('courierTelemetryWsFields expose le contrat client', () => {
    const fields = courierTelemetryWsFields({
      headingDegrees: 10,
      speedMps: 2,
      batteryPercent: 80,
      recordedAt: '2026-07-14T01:00:00.000Z',
    });
    expect(fields).toEqual({
      courierHeadingDegrees: 10,
      courierSpeedMps: 2,
      courierBatteryPercent: 80,
      courierRecordedAt: '2026-07-14T01:00:00.000Z',
    });
  });
});
