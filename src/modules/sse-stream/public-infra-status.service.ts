import { DbMaintenanceService, SystemHealthCheckResult } from '@modules/db-maintenance/db-maintenance.service';
import { probeRedis } from '@modules/db-maintenance/system-exchange.probes';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PublicInfraProbe = {
  id: string;
  name: string;
  desc: string;
  state: 'ok' | 'degraded' | 'down' | 'unknown';
  latencyMs: number | null;
  details: string;
};

export type PublicInfraSnapshot = {
  checkedAt: string;
  components: PublicInfraProbe[];
};

@Injectable()
export class PublicInfraStatusService {
  constructor(
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly config: ConfigService,
  ) {}

  async probeAll(): Promise<PublicInfraSnapshot> {
    const checkedAt = new Date().toISOString();
    const [mongo, map, storage, mail, sms, whatsapp, redis] =
      await Promise.all([
        this.dbMaintenance.runPublicSystemHealthCheck('mongodb-status'),
        this.dbMaintenance.runPublicSystemHealthCheck('map-engine-status'),
        this.dbMaintenance.runPublicSystemHealthCheck('file-storage-engines-status'),
        this.dbMaintenance.runPublicSystemHealthCheck('mail-health-status'),
        this.dbMaintenance.runPublicSystemHealthCheck('bird-sms-api-status'),
        this.dbMaintenance.runPublicSystemHealthCheck('bird-whatsapp-api-status'),
        probeRedis(this.config),
      ]);

    const components: PublicInfraProbe[] = [
      this.fromHealthCheck('mongodb', {
        name: 'MongoDB',
        desc: 'Moteur de stockage des données applicatives.',
      }, mongo),
      this.fromRedisProbe(redis),
      this.fromHealthCheck('map', {
        name: 'Moteur cartographique',
        desc: 'Géocodage et cartes multi-moteurs (Mapbox, Google Maps).',
      }, map),
      this.fromHealthCheck('file-storage', {
        name: 'Stockage fichiers',
        desc: 'Médias et fichiers multi-moteurs (Firebase Storage, GCS, Amazon S3).',
      }, storage),
      this.fromHealthCheck('email', {
        name: 'E-mail',
        desc: 'Envoi des messages transactionnels (SMTP).',
      }, mail),
      this.fromHealthCheck('sms', {
        name: 'SMS',
        desc: 'Notifications SMS (Bird).',
      }, sms),
      this.fromHealthCheck('whatsapp', {
        name: 'WhatsApp',
        desc: 'Notifications WhatsApp (Bird).',
      }, whatsapp),
    ];

    return { checkedAt, components };
  }

  private fromHealthCheck(
    id: string,
    meta: { name: string; desc: string },
    result: SystemHealthCheckResult,
  ): PublicInfraProbe {
    return {
      id,
      name: meta.name,
      desc: meta.desc,
      state: this.mapHealthStatus(result.status),
      latencyMs: result.totalEvaluateTimeMs,
      details: this.sanitizeDetails(result.details),
    };
  }

  private fromRedisProbe(redis: Awaited<ReturnType<typeof probeRedis>>): PublicInfraProbe {
    return {
      id: 'redis',
      name: 'Redis',
      desc: 'Cache, files BullMQ et pont SSE.',
      state:
        redis.status === 'disabled'
          ? 'unknown'
          : this.mapExchangeStatus(redis.status),
      latencyMs: redis.latencyMs,
      details: this.sanitizeDetails(redis.details),
    };
  }

  private mapHealthStatus(
    status: SystemHealthCheckResult['status'],
  ): PublicInfraProbe['state'] {
    if (status === 'healthy') return 'ok';
    if (status === 'degraded') return 'degraded';
    return 'down';
  }

  private mapExchangeStatus(
    status: 'healthy' | 'degraded' | 'down' | 'disabled' | 'unknown',
  ): PublicInfraProbe['state'] {
    if (status === 'healthy') return 'ok';
    if (status === 'degraded') return 'degraded';
    if (status === 'disabled' || status === 'unknown') return 'unknown';
    return 'down';
  }

  private sanitizeDetails(raw: string): string {
    return String(raw || '')
      .replace(/\b[A-Z0-9_]{16,}\b/g, '[redacted]')
      .slice(0, 280);
  }
}
