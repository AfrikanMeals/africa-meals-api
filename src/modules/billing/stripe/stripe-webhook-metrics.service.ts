import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildStripeWebhookMetricsSnapshot,
  type StripeWebhookMetricsSnapshot,
} from './stripe-webhook-metrics.util';

const DEFAULT_MAX_SAMPLES = 200;

@Injectable()
export class StripeWebhookMetricsService {
  private readonly logger = new Logger(StripeWebhookMetricsService.name);
  private readonly maxSamples: number;
  private readonly samples: Array<{
    durationMs: number;
    eventType: string;
    at: number;
  }> = [];

  constructor(private readonly config: ConfigService) {
    const raw = Number(
      this.config.get<string>('STRIPE_WEBHOOK_METRICS_MAX_SAMPLES') ?? '',
    );
    this.maxSamples =
      Number.isFinite(raw) && raw > 0
        ? Math.trunc(raw)
        : DEFAULT_MAX_SAMPLES;
  }

  record(durationMs: number, eventType: string): void {
    const ms = Math.max(0, Math.round(durationMs * 10) / 10);
    this.samples.push({
      durationMs: ms,
      eventType: eventType.trim() || 'unknown',
      at: Date.now(),
    });
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }

    const targetP95 = this.p95TargetMs();
    if (ms > targetP95 * 2) {
      this.logger.warn(
        `Stripe webhook slow ack type=${eventType} durationMs=${ms} targetP95Ms=${targetP95}`,
      );
    }
  }

  snapshot(): StripeWebhookMetricsSnapshot {
    return buildStripeWebhookMetricsSnapshot(this.samples);
  }

  p95TargetMs(): number {
    const raw = Number(
      this.config.get<string>('STRIPE_WEBHOOK_P95_TARGET_MS') ?? '500',
    );
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 500;
  }
}
