/**
 * Télémétrie live livreur propagée Redis GEO → order:tracking / fleet:location.
 */
export type CourierLiveTelemetry = {
  headingDegrees?: number | null;
  speedMps?: number | null;
  batteryPercent?: number | null;
  /** ISO-8601 appareil ; sinon horodatage serveur. */
  recordedAt?: string | null;
};

export function normalizeCourierLiveTelemetry(
  raw?: CourierLiveTelemetry | null,
): CourierLiveTelemetry {
  if (!raw) return {};
  const heading = Number(raw.headingDegrees);
  const speed = Number(raw.speedMps);
  const battery = Number(raw.batteryPercent);
  const recordedAt =
    typeof raw.recordedAt === 'string' && raw.recordedAt.trim()
      ? raw.recordedAt.trim()
      : null;
  return {
    headingDegrees:
      Number.isFinite(heading) && heading >= 0 && heading <= 360
        ? heading
        : null,
    speedMps:
      Number.isFinite(speed) && speed >= 0 && speed <= 80 ? speed : null,
    batteryPercent:
      Number.isFinite(battery) && battery >= 0 && battery <= 100
        ? Math.round(battery)
        : null,
    recordedAt,
  };
}

/** Champs WS / Redis partagés. */
export function courierTelemetryWsFields(
  t: CourierLiveTelemetry,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (t.headingDegrees != null) out.courierHeadingDegrees = t.headingDegrees;
  if (t.speedMps != null) out.courierSpeedMps = t.speedMps;
  if (t.batteryPercent != null) out.courierBatteryPercent = t.batteryPercent;
  out.courierRecordedAt = t.recordedAt ?? new Date().toISOString();
  return out;
}
