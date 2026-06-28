import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  connect as mqttConnect,
  type IClientOptions,
  type MqttClient,
} from 'mqtt';
import { readMqttBrokerConfig } from './mqtt-broker-config.util';

export type SharedMqttRuntimeStatus = {
  enabled: boolean;
  state: 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  lastError: string | null;
};

function isMqttAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('not authorized') || m.includes('bad user name or password');
}

/** Client MQTT publisher unique (API ws-notify + domain-events). */
@Injectable()
export class SharedMqttPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SharedMqttPublisherService.name);
  private client: MqttClient | null = null;
  private connected = false;
  private authBlocked = false;
  private state: SharedMqttRuntimeStatus['state'] = 'disabled';
  private lastError: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.connected = false;
    this.state = 'disabled';
  }

  isConnected(): boolean {
    return this.connected;
  }

  isAuthBlocked(): boolean {
    return this.authBlocked;
  }

  getStatus(): SharedMqttRuntimeStatus {
    return {
      enabled: this.client != null,
      state: this.state,
      lastError: this.lastError,
    };
  }

  recoverAfterOutage(): void {
    if (this.authBlocked || this.connected) return;
    if (this.client) return;
    this.connect();
  }

  async publish(
    topic: string,
    body: string,
    qos: 0 | 1 | 2 = 1,
  ): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('mqtt_not_connected');
    }
    await new Promise<void>((resolve, reject) => {
      this.client!.publish(topic, body, { qos, retain: false }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private connect(): void {
    const cfg = this.mqttConfig();
    if (!cfg) {
      this.logger.log('Shared MQTT disabled (MQTT_BROKER_* absent)');
      this.state = 'disabled';
      return;
    }
    this.state = 'connecting';
    this.logger.log(
      `Shared MQTT connecting: ${cfg.url} (user=${cfg.options.username ?? '—'})`,
    );
    const client = mqttConnect(cfg.url, cfg.options);
    client.on('connect', () => {
      this.connected = true;
      this.state = 'connected';
      this.lastError = null;
      this.logger.log(`Shared MQTT connected: ${cfg.url}`);
    });
    client.on('reconnect', () => {
      this.state = 'reconnecting';
      this.logger.warn('Shared MQTT reconnecting...');
    });
    client.on('error', (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.state = 'error';
      this.lastError = msg;
      this.logger.warn(`Shared MQTT error: ${msg}`);
      if (isMqttAuthError(msg)) {
        this.logger.warn(
          'Shared MQTT auth rejected; stopping reconnect until restart.',
        );
        this.connected = false;
        this.authBlocked = true;
        client.end(true);
      }
    });
    client.on('close', () => {
      this.connected = false;
      if (this.state !== 'error') {
        this.state = 'connecting';
      }
    });
    this.client = client;
  }

  private mqttConfig(): { url: string; options: IClientOptions } | null {
    return readMqttBrokerConfig(this.config);
  }
}

@Global()
@Module({
  providers: [SharedMqttPublisherService],
  exports: [SharedMqttPublisherService],
})
export class SharedMqttModule {}
