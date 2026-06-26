import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import {
  JobCompletedPayload,
  JobFailedPayload,
  JobProgressPayload,
} from '../../common/domain-events/payloads/job-domain-event.payloads';
import { DomainEventType } from '../../common/domain-events/domain-event-types';
import { DomainEventDraft } from '../../common/domain-events/domain-event.types';
import { OrderDomainBridgeService } from '@modules/domain-event-handlers/order-domain-bridge.service';
import { AdminJobProgressService } from './admin-job-progress.service';

type AdminJobEvent =
  | { type: 'job.progress'; payload: JobProgressPayload }
  | { type: 'job.completed'; payload: JobCompletedPayload }
  | { type: 'job.failed'; payload: JobFailedPayload };

@Injectable()
export class AdminJobEmitterService {
  constructor(
    @Inject(forwardRef(() => OrderDomainBridgeService))
    @Optional()
    private readonly domainBridge?: OrderDomainBridgeService,
    @Optional()
    private readonly adminJobProgress?: AdminJobProgressService,
  ) {}

  emitProgress(payload: JobProgressPayload): Promise<void> {
    return this.emit({ type: 'job.progress', payload });
  }

  emitCompleted(payload: JobCompletedPayload): Promise<void> {
    return this.emit({ type: 'job.completed', payload });
  }

  emitFailed(payload: JobFailedPayload): Promise<void> {
    return this.emit({ type: 'job.failed', payload });
  }

  private async emit(event: AdminJobEvent): Promise<void> {
    const jobId = String(event.payload.jobId ?? '').trim();
    // Toujours publier en synchrone (Redis + observe in-process) — ne pas attendre
    // la file domain-events-handlers, sinon l’UI admin reste à 0 %.
    if (jobId && this.adminJobProgress) {
      if (event.type === 'job.progress') {
        this.adminJobProgress.emitProgress(event.payload);
      } else if (event.type === 'job.completed') {
        this.adminJobProgress.emitCompleted(event.payload);
      } else {
        this.adminJobProgress.emitFailed(event.payload);
      }
    }
    if (this.domainBridge?.enabled()) {
      await this.domainBridge.emit(
        event as DomainEventDraft<DomainEventType>,
      );
    }
  }
}
