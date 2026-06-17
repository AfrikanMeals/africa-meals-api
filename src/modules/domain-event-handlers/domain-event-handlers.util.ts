import { ConfigService } from '@nestjs/config';

export function isDomainEventsEnabled(config: ConfigService): boolean {
  const raw = (config.get<string>('DOMAIN_EVENTS_ENABLED') ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** WS dispatch via bus MQTT (EDA-003) plutôt que handlers API in-process. */
export function isDomainEventsWsViaBus(config: ConfigService): boolean {
  if (!isDomainEventsEnabled(config)) return false;
  const raw = (config.get<string>('DOMAIN_EVENTS_WS_VIA_BUS') ?? 'true')
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
}

/** EDA-008 : l’API ne doit pas appeler les notifiers WS si le bus domaine est actif. */
export function shouldEmitLegacyAdWsFromApi(config: ConfigService): boolean {
  return !isDomainEventsEnabled(config);
}
