import { Injectable } from '@nestjs/common';
import { DomainEventEnvelope } from '../../../common/domain-events/domain-event.types';
import {
  JobCompletedPayload,
  JobFailedPayload,
  JobProgressPayload,
} from '../../../common/domain-events/payloads/job-domain-event.payloads';
import { AdminJobProgressService } from '@modules/admin-jobs/admin-job-progress.service';

@Injectable()
export class JobDomainEventHandler {
  constructor(private readonly jobs: AdminJobProgressService) {}

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'job.progress':
        this.jobs.emitProgress(envelope.payload as JobProgressPayload);
        break;
      case 'job.completed':
        this.jobs.emitCompleted(envelope.payload as JobCompletedPayload);
        break;
      case 'job.failed':
        this.jobs.emitFailed(envelope.payload as JobFailedPayload);
        break;
      default:
        break;
    }
  }
}
