import { DbMaintenanceService, SystemHealthCheckResult } from '@modules/db-maintenance/db-maintenance.service';
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

const MANUAL_PROBE_HINT = ' · sonde réseau via Run manuel admin uniquement';

@Injectable()
export class PublicInfraStatusService {
  constructor(
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly config: ConfigService,
  ) {}

  /** Config locale uniquement — aucun appel réseau vers tiers (Mapbox, Bird, SMTP, etc.). */
  async probeAll(): Promise<PublicInfraSnapshot> {
    const checkedAt = new Date().toISOString();
    const [mongo, map, storage, mail, sms, whatsapp] = await Promise.all([
      this.dbMaintenance.runPublicSystemHealthCheck('mongodb-status'),
      this.dbMaintenance.runPublicSystemHealthCheck('map-engine-status'),
      this.dbMaintenance.runPublicSystemHealthCheck('file-storage-engines-status'),
      this.dbMaintenance.runPublicSystemHealthCheck('mail-health-status'),
      this.dbMaintenance.runPublicSystemHealthCheck('bird-sms-api-status'),
      this.dbMaintenance.runPublicSystemHealthCheck('bird-whatsapp-api-status'),
    ]);

    const redisConfigured = Boolean(
      String(this.config.get<string>('REDIS_URL') ?? '').trim() ||
        String(this.config.get<string>('REDIS_HOST') ?? '').trim(),
    );

    const components: PublicInfraProbe[] = [
      this.fromHealthCheck('mongodb', {
        name: 'MongoDB',
        desc: 'Moteur de stockage des données applicatives.',
      }, mongo),
      {
        id: 'redis',
        name: 'Redis',
        desc: 'Cache, files BullMQ et pont SSE.',
        state: redisConfigured ? 'ok' : 'unknown',
        latencyMs: null,
        details: this.sanitizeDetails(
          redisConfigured
            ? `configuré${MANUAL_PROBE_HINT}`
            : 'non configuré',
        ),
      },
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

  private mapHealthStatus(
    status: SystemHealthCheckResult['status'],
  ): PublicInfraProbe['state'] {
    if (status === 'healthy') return 'ok';
    if (status === 'degraded') return 'degraded';
    return 'down';
  }

  private sanitizeDetails(raw: string): string {
    return String(raw || '')
      .replace(/\b[A-Z0-9_]{16,}\b/g, '[redacted]')
      .slice(0, 280);
  }
}
