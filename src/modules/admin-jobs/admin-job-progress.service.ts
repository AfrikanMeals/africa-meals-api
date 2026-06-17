import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  JobCompletedPayload,
  JobFailedPayload,
  JobProgressPayload,
} from '../../common/domain-events/payloads/job-domain-event.payloads';

export type AdminJobSnapshot = JobProgressPayload & {
  running: boolean;
};

const idle = (jobId: string): AdminJobSnapshot => ({
  jobId,
  pct: 0,
  label: 'idle',
  running: false,
});

@Injectable()
export class AdminJobProgressService {
  private readonly subjects = new Map<string, Subject<AdminJobSnapshot>>();
  private readonly last = new Map<string, AdminJobSnapshot>();

  observe(jobId: string): Observable<AdminJobSnapshot> {
    const id = jobId.trim();
    return new Observable((subscriber) => {
      subscriber.next(this.last.get(id) ?? idle(id));
      const subject = this.getSubject(id);
      const sub = subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }

  emitProgress(payload: JobProgressPayload): void {
    this.push({
      ...payload,
      running: payload.pct < 100,
    });
  }

  emitCompleted(payload: JobCompletedPayload): void {
    this.push({
      jobId: payload.jobId,
      pct: 100,
      label: 'complete',
      phase: 'complete',
      running: false,
    });
  }

  emitFailed(payload: JobFailedPayload): void {
    this.push({
      jobId: payload.jobId,
      pct: 0,
      label: 'error',
      phase: 'error',
      running: false,
    });
  }

  private push(snapshot: AdminJobSnapshot): void {
    this.last.set(snapshot.jobId, snapshot);
    this.getSubject(snapshot.jobId).next(snapshot);
  }

  private getSubject(jobId: string): Subject<AdminJobSnapshot> {
    let subject = this.subjects.get(jobId);
    if (!subject) {
      subject = new Subject<AdminJobSnapshot>();
      this.subjects.set(jobId, subject);
    }
    return subject;
  }
}
