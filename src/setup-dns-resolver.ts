import * as dns from 'node:dns';

/**
 * Résolveurs DNS optionnels. Par défaut : résolveurs **système** (ne pas appeler setServers).
 * Sur certains réseaux (VPN, FAI), 1.1.1.1 / 8.8.8.8 bloquent ou ralentissent les lookups SRV
 * Atlas (`_mongodb._tcp.*`) — ce qui provoque « Unable to connect » pendant ~70s.
 *
 * Forcer des serveurs publics uniquement si besoin :
 *   DNS_SERVERS=1.1.1.1,8.8.8.8
 */
function parseDnsServers(): string[] | null {
  const raw = process.env.DNS_SERVERS?.trim();
  if (!raw || raw === 'system' || raw === 'default') return null;
  if (raw === 'off' || raw === 'false' || raw === '0') return null;
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * À importer en premier dans `main.ts` (avant Nest / Mongoose).
 */
export function setupDnsResolver(): void {
  const servers = parseDnsServers();
  if (servers != null && servers.length > 0) {
    dns.setServers(servers);
  }

  const order = process.env.DNS_RESULT_ORDER?.trim();
  if (
    order &&
    typeof dns.setDefaultResultOrder === 'function' &&
    (order === 'ipv4first' || order === 'verbatim')
  ) {
    dns.setDefaultResultOrder(order);
  }
}

setupDnsResolver();
