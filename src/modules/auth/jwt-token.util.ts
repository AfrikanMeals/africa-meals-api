/** Parse une durée JWT (`30m`, `7d`, `1h`) en secondes. */
export function parseJwtDurationToSeconds(raw: string, fallbackSec: number): number {
  const v = raw.trim();
  const m = /^(\d+)\s*([smhd])$/i.exec(v);
  if (!m) return fallbackSec;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return fallbackSec;
  switch (m[2].toLowerCase()) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86_400;
    default:
      return fallbackSec;
  }
}

export function isProductionNodeEnv(): boolean {
  const env = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  return env === 'production' || env === 'prod';
}
