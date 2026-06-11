import axios from 'axios';

export type LoginGeoInfo = {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
};

function isPrivateOrLocalIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v || v === 'unknown' || v === 'inconnu') return true;
  if (v === '::1' || v.startsWith('127.') || v.startsWith('10.')) return true;
  if (v.startsWith('192.168.') || v.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(v)) return true;
  return false;
}

export async function lookupLoginGeo(ip: string): Promise<LoginGeoInfo | null> {
  if (isPrivateOrLocalIp(ip)) return null;
  try {
    const { data } = await axios.get<{
      status?: string;
      city?: string;
      regionName?: string;
      country?: string;
      countryCode?: string;
      timezone?: string;
    }>(`http://ip-api.com/json/${encodeURIComponent(ip)}`, {
      params: { fields: 'status,city,regionName,country,countryCode,timezone' },
      timeout: 2500,
      validateStatus: () => true,
    });
    if (!data || data.status !== 'success') return null;
    return {
      city: data.city?.trim() || undefined,
      region: data.regionName?.trim() || undefined,
      country: data.country?.trim() || undefined,
      countryCode: data.countryCode?.trim() || undefined,
      timezone: data.timezone?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function formatLoginGeo(geo: LoginGeoInfo | null): string {
  if (!geo) return 'Non disponible (IP locale ou lookup indisponible)';
  const parts = [geo.city, geo.region, geo.country].filter(Boolean);
  const base = parts.length ? parts.join(', ') : 'Non disponible';
  if (geo.countryCode) return `${base} (${geo.countryCode})`;
  return base;
}
