import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppService, HealthPayload } from '../../app.service';
import { parsePositiveInt } from '../../common/bullmq-redis-connection';

import { PublicInfraStatusService, PublicInfraProbe } from './public-infra-status.service';
import {
  resolveAdminProbeEndpointUrl,
  resolveAdminProbeHealthUrl,
  resolveWebProbeEndpointUrl,
  resolveWsProbeEndpointUrl,
  resolveWsProbeFetchUrl,
} from './status-probe-urls.util';

export type PublicStatusServiceProbe = {
  id: 'web' | 'api' | 'ws' | 'admin';
  name: string;
  state: 'ok' | 'degraded' | 'down' | 'unknown';
  latencyMs: number | null;
  details: string;
  endpoint: string;
};

export type PublicStatusSnapshot = {
  checkedAt: string;
  summary: 'ok' | 'partial' | 'down' | 'checking';
  services: PublicStatusServiceProbe[];
  infra: PublicInfraProbe[];
};

@Injectable()
export class PublicStatusProbeService {
  constructor(
    private readonly config: ConfigService,
    private readonly app: AppService,
    private readonly publicInfra: PublicInfraStatusService,
  ) {}

  async probeAll(): Promise<PublicStatusSnapshot> {
    const checkedAt = new Date().toISOString();
    const webEndpoint = resolveWebProbeEndpointUrl(this.config);
    const wsFetchUrl = resolveWsProbeFetchUrl(this.config);
    const wsEndpoint = resolveWsProbeEndpointUrl(this.config);
    const adminFetchUrl = resolveAdminProbeHealthUrl(this.config);
    const adminEndpoint = resolveAdminProbeEndpointUrl(this.config);

    const [api, ws, admin, infraSnapshot] = await Promise.all([
      this.probeApiHealth(),
      this.probeJsonHealth(wsFetchUrl, 'ws', wsEndpoint),
      this.probeJsonHealth(adminFetchUrl, 'admin', adminEndpoint),
      this.publicInfra.probeAll(),
    ]);

    const services: PublicStatusServiceProbe[] = [
      {
        id: 'web',
        name: 'Site web',
        state: 'ok',
        latencyMs: 0,
        details: 'Site vitrine accessible.',
        endpoint: webEndpoint,
      },
      api,
      ws,
      admin,
    ];

    const states = [
      ...services.map((s) => s.state),
      ...infraSnapshot.components.map((c) => c.state),
    ];
    let summary: PublicStatusSnapshot['summary'] = 'ok';
    if (states.includes('down')) summary = 'down';
    else if (states.includes('degraded') || states.includes('unknown')) {
      summary = 'partial';
    }

    return {
      checkedAt,
      summary,
      services,
      infra: infraSnapshot.components,
    };
  }

  private async probeApiHealth(): Promise<PublicStatusServiceProbe> {
    const started = performance.now();
    try {
      const body = await this.app.getHealth();
      const latencyMs = Math.round(performance.now() - started);
      const state = body.status === 'ok' ? 'ok' : 'degraded';
      return {
        id: 'api',
        name: 'API',
        state,
        latencyMs,
        details: this.formatHealthDetails(body),
        endpoint: '/health',
      };
    } catch (error) {
      return {
        id: 'api',
        name: 'API',
        state: 'down',
        latencyMs: null,
        details: error instanceof Error ? error.message : 'probe_failed',
        endpoint: '/health',
      };
    }
  }

  private async probeJsonHealth(
    url: string,
    id: 'ws' | 'admin',
    endpoint?: string,
  ): Promise<PublicStatusServiceProbe> {
    const displayEndpoint = endpoint ?? url;
    const started = performance.now();
    const timeoutMs = parsePositiveInt(
      this.config.get<string>('STATUS_PROBE_TIMEOUT_MS'),
      4000,
    );
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Math.round(performance.now() - started);
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        service?: string;
        version?: string;
        mongodb?: { reachable?: boolean };
        timestamp?: string;
      };
      let state: PublicStatusServiceProbe['state'] = 'down';
      if (res.ok) {
        if (body.status === 'ok') state = 'ok';
        else if (body.status === 'degraded') state = 'degraded';
        else state = 'ok';
      }
      return {
        id,
        name: id === 'admin' ? 'Administration' : 'Temps réel',
        state,
        latencyMs,
        details: this.formatRemoteHealth(body, res.status),
        endpoint: displayEndpoint,
      };
    } catch (error) {
      return {
        id,
        name: id === 'admin' ? 'Administration' : 'Temps réel',
        state: id === 'admin' ? 'unknown' : 'down',
        latencyMs: null,
        details: error instanceof Error ? error.message : 'probe_failed',
        endpoint: displayEndpoint,
      };
    }
  }

  private formatHealthDetails(body: HealthPayload): string {
    const parts: string[] = [body.service];
    if (body.version) parts.push(`version ${body.version}`);
    if (typeof body.mongodb?.reachable === 'boolean') {
      parts.push(`MongoDB: ${body.mongodb.reachable ? 'joignable' : 'indisponible'}`);
    }
    parts.push(`sondé ${body.timestamp}`);
    return parts.join(' · ');
  }

  private formatRemoteHealth(
    body: {
      status?: string;
      service?: string;
      version?: string;
      mongodb?: { reachable?: boolean };
      timestamp?: string;
    },
    httpStatus: number,
  ): string {
    const parts: string[] = [];
    if (body.service) parts.push(body.service);
    if (body.version) parts.push(`version ${body.version}`);
    if (typeof body.mongodb?.reachable === 'boolean') {
      parts.push(
        `MongoDB: ${body.mongodb.reachable ? 'joignable' : 'indisponible'}`,
      );
    }
    if (body.timestamp) parts.push(`sondé ${body.timestamp}`);
    return parts.join(' · ') || `HTTP ${httpStatus}`;
  }
}
