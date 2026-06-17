import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppService, HealthPayload } from '../../app.service';
import { parsePositiveInt } from '../../common/bullmq-redis-connection';

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
};

@Injectable()
export class PublicStatusProbeService {
  constructor(
    private readonly config: ConfigService,
    private readonly app: AppService,
  ) {}

  async probeAll(): Promise<PublicStatusSnapshot> {
    const checkedAt = new Date().toISOString();
    const webUrl =
      this.config.get<string>('STATUS_PROBE_WEB_URL')?.trim() ||
      'https://wise-eat.com/';
    const adminUrl =
      this.config.get<string>('STATUS_PROBE_ADMIN_URL')?.trim() ||
      'https://admin.wise-eat.com/';
    const wsBase = this.resolveWsPublicBase();

    const [api, ws, admin] = await Promise.all([
      this.probeApiHealth(),
      this.probeJsonHealth(`${wsBase}/api/health`, 'ws'),
      this.probeHead(adminUrl, 'admin'),
    ]);

    const services: PublicStatusServiceProbe[] = [
      {
        id: 'web',
        name: 'Site web',
        state: 'ok',
        latencyMs: 0,
        details: 'Site vitrine accessible.',
        endpoint: webUrl,
      },
      api,
      ws,
      admin,
    ];

    const states = services.map((s) => s.state);
    let summary: PublicStatusSnapshot['summary'] = 'ok';
    if (states.includes('down')) summary = 'down';
    else if (states.includes('degraded') || states.includes('unknown')) {
      summary = 'partial';
    }

    return { checkedAt, summary, services };
  }

  private resolveWsPublicBase(): string {
    const direct = this.config.get<string>('WS_BASE_URL')?.trim();
    if (direct) return direct.replace(/\/+$/, '');
    const internal = this.config
      .get<string>('AFRICA_MEALS_WS_INTERNAL_URL')
      ?.trim()
      ?.replace(/\/+$/, '');
    if (internal) return internal;
    return 'https://ws.wise-eat.com';
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
    id: 'ws',
  ): Promise<PublicStatusServiceProbe> {
    const started = performance.now();
    const timeoutMs = parsePositiveInt(
      this.config.get<string>('STATUS_PROBE_TIMEOUT_MS'),
      8000,
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
        name: 'Temps réel',
        state,
        latencyMs,
        details: this.formatRemoteHealth(body, res.status),
        endpoint: url,
      };
    } catch (error) {
      return {
        id,
        name: 'Temps réel',
        state: 'down',
        latencyMs: null,
        details: error instanceof Error ? error.message : 'probe_failed',
        endpoint: url,
      };
    }
  }

  private async probeHead(
    url: string,
    id: 'admin',
  ): Promise<PublicStatusServiceProbe> {
    const started = performance.now();
    const timeoutMs = parsePositiveInt(
      this.config.get<string>('STATUS_PROBE_TIMEOUT_MS'),
      8000,
    );
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Math.round(performance.now() - started);
      return {
        id,
        name: 'Administration',
        state: res.ok ? 'ok' : 'down',
        latencyMs,
        details: `HTTP ${res.status}`,
        endpoint: url,
      };
    } catch (error) {
      return {
        id,
        name: 'Administration',
        state: 'unknown',
        latencyMs: null,
        details: error instanceof Error ? error.message : 'probe_failed',
        endpoint: url,
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
