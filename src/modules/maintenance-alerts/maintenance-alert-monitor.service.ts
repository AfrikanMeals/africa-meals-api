import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DbMaintenanceService,
  SystemHealthCheckResult,
} from '@modules/db-maintenance/db-maintenance.service';
import {
  mqttToExchange,
  probeRedis,
} from '@modules/db-maintenance/system-exchange.probes';
import type { SystemExchangeStatus } from '@modules/db-maintenance/system-exchange.types';
import { MaintenanceAlertSettingsService } from './maintenance-alert-settings.service';
import { MaintenanceAlertNotifierService } from './maintenance-alert-notifier.service';

type MonitoredService = {
  key: string;
  label: string;
  status: AlertableStatus;
  details: string;
  checkedAt: string;
};

type AlertableStatus = 'healthy' | 'degraded' | 'down' | 'disabled' | 'unknown';

type LastAlertState = {
  status: string;
  alertedAt?: Date | null;
  recoveredAt?: Date | null;
};

const MONITOR_INTERVAL_MS = 1800_000; // 30 minutes

@Injectable()
export class MaintenanceAlertMonitorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MaintenanceAlertMonitorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly settingsService: MaintenanceAlertSettingsService,
    private readonly notifier: MaintenanceAlertNotifierService,
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), MONITOR_INTERVAL_MS);
    this.logger.log(
      `Maintenance alert monitor started (interval=${MONITOR_INTERVAL_MS}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.settingsService.getSettingsInternal();
      if (!settings.alertsEnabled) return;

      const services = await this.collectMonitoredServices();
      const cooldownMs = (settings.cooldownMinutes ?? 15) * 60_000;
      const now = Date.now();

      for (const service of services) {
        const prev = readLastAlertState(settings, service.key);
        const prevStatus = prev?.status as AlertableStatus | undefined;
        const prevAlertedAt = prev?.alertedAt
          ? new Date(prev.alertedAt).getTime()
          : 0;

        const isBad = isBadStatus(service.status);
        const wasBad = prevStatus != null && isBadStatus(prevStatus);

        if (isBad) {
          const statusChanged = prevStatus !== service.status;
          const cooldownExpired =
            !prevAlertedAt || now - prevAlertedAt >= cooldownMs;
          if (!wasBad || statusChanged || cooldownExpired) {
            await this.notifier.notify(settings, {
              kind: 'incident',
              serviceKey: service.key,
              label: service.label,
              status: service.status,
              previousStatus: prevStatus,
              details: service.details,
              checkedAt: service.checkedAt,
            });
            await this.settingsService.updateAlertState(service.key, {
              status: service.status,
              alertedAt: new Date(),
              recoveredAt: null,
            });
            this.logger.warn(
              `Maintenance alert sent: ${service.key} status=${service.status}`,
            );
          }
          continue;
        }

        if (wasBad && service.status === 'healthy') {
          await this.notifier.notify(settings, {
            kind: 'recovery',
            serviceKey: service.key,
            label: service.label,
            status: service.status,
            previousStatus: prevStatus,
            details: service.details,
            checkedAt: service.checkedAt,
          });
          await this.settingsService.updateAlertState(service.key, {
            status: service.status,
            alertedAt: null,
            recoveredAt: new Date(),
          });
          this.logger.log(`Maintenance recovery alert sent: ${service.key}`);
        } else if (prevStatus !== service.status) {
          await this.settingsService.updateAlertState(service.key, {
            status: service.status,
            alertedAt: prev?.alertedAt ?? null,
            recoveredAt: prev?.recoveredAt ?? null,
          });
        }
      }
    } catch (e) {
      this.logger.warn(
        `Maintenance monitor tick: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async collectMonitoredServices(): Promise<MonitoredService[]> {
    const [checks, runtime, mqtt] = await Promise.all([
      this.dbMaintenance.runAllSystemHealthChecksInternal(),
      this.dbMaintenance.getInfraRuntimeSettingsInternal(),
      this.dbMaintenance.getInfraMqttStatusInternal(),
    ]);

    const services: MonitoredService[] = checks.map((check) =>
      mapHealthCheck(check),
    );

    if (runtime.redisManagerEnabled) {
      const redisProbe = await probeRedis(this.config);
      services.push({
        key: 'redis-status',
        label: 'Redis',
        status: mapExchangeStatus(redisProbe.status),
        details: redisProbe.details,
        checkedAt: new Date().toISOString(),
      });
    }

    if (runtime.mqBrokerEnabled) {
      const apiState = mqttToExchange(mqtt.apiPublisher.state);
      const wsState = mqttToExchange(mqtt.wsSubscriber.state);
      const status = worstStatus(apiState, wsState);
      services.push({
        key: 'mqtt-broker-status',
        label: 'MQTT Broker',
        status: mapExchangeStatus(status),
        details: [
          `Publisher API : ${mqtt.apiPublisher.state}`,
          mqtt.apiPublisher.lastError
            ? `Erreur API : ${mqtt.apiPublisher.lastError}`
            : null,
          `Subscriber WS : ${mqtt.wsSubscriber.state}`,
          mqtt.wsSubscriber.lastError
            ? `Erreur WS : ${mqtt.wsSubscriber.lastError}`
            : null,
          mqtt.apiPublisher.lastTopicSeen
            ? `Dernier topic API : ${mqtt.apiPublisher.lastTopicSeen}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        checkedAt: mqtt.checkedAt,
      });
    }

    return services;
  }
}

function mapHealthCheck(check: SystemHealthCheckResult): MonitoredService {
  return {
    key: check.key,
    label: check.label,
    status: check.status,
    details: check.details,
    checkedAt: check.checkedAt,
  };
}

function mapExchangeStatus(
  status: SystemExchangeStatus,
): AlertableStatus {
  if (status === 'healthy') return 'healthy';
  if (status === 'degraded') return 'degraded';
  if (status === 'down') return 'down';
  if (status === 'disabled') return 'disabled';
  return 'unknown';
}

function isBadStatus(status: AlertableStatus): boolean {
  return status === 'down' || status === 'degraded';
}

function worstStatus(
  a: SystemExchangeStatus,
  b: SystemExchangeStatus,
): SystemExchangeStatus {
  const rank: Record<SystemExchangeStatus, number> = {
    down: 4,
    degraded: 3,
    unknown: 2,
    healthy: 1,
    disabled: 0,
  };
  return rank[a] >= rank[b] ? a : b;
}

function readLastAlertState(
  settings: { lastAlertStates?: Map<string, LastAlertState> | Record<string, LastAlertState> },
  serviceKey: string,
): LastAlertState | undefined {
  const states = settings.lastAlertStates;
  if (!states) return undefined;
  if (states instanceof Map) {
    return states.get(serviceKey) as LastAlertState | undefined;
  }
  return (states as Record<string, LastAlertState>)[serviceKey];
}
