import { ConfigService } from '@nestjs/config';
import {
  isDomainEventsEnabled,
  isDomainEventsWsViaBus,
  shouldEmitLegacyAdWsFromApi,
} from './domain-event-handlers.util';

function mockConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('domain-event-handlers.util (EDA-008)', () => {
  it('shouldEmitLegacyAdWsFromApi is false when domain events enabled', () => {
    const config = mockConfig({ DOMAIN_EVENTS_ENABLED: 'true' });
    expect(isDomainEventsEnabled(config)).toBe(true);
    expect(shouldEmitLegacyAdWsFromApi(config)).toBe(false);
  });

  it('shouldEmitLegacyAdWsFromApi is true when domain events disabled', () => {
    const config = mockConfig({ DOMAIN_EVENTS_ENABLED: 'false' });
    expect(shouldEmitLegacyAdWsFromApi(config)).toBe(true);
  });

  it('wsViaBus requires domain events enabled', () => {
    const off = mockConfig({ DOMAIN_EVENTS_ENABLED: 'false' });
    expect(isDomainEventsWsViaBus(off)).toBe(false);
    const on = mockConfig({
      DOMAIN_EVENTS_ENABLED: 'true',
      DOMAIN_EVENTS_WS_VIA_BUS: 'true',
    });
    expect(isDomainEventsWsViaBus(on)).toBe(true);
  });
});
