import { Injectable, Optional } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { SseRedisPublishService } from '../../common/sse/sse-redis-publish.service';
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

const TERMINAL_CLEANUP_MS = 30 * 60 * 1000;

@Injectable()
export class AdminJobProgressService {
  private readonly subjects = new Map<string, Subject<AdminJobSnapshot>>();
  private readonly last = new Map<string, AdminJobSnapshot>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Optional() private readonly sseRedis?: SseRedisPublishService,
  ) {}

  observe(jobId: string): Observable<AdminJobSnapshot> {
    const id = jobId.trim();
    return new Observable((subscriber) => {
      subscriber.next(this.last.get(id) ?? idle(id));
      const subject = this.getSubject(id);
      const sub = subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }

  getSnapshot(jobId: string): AdminJobSnapshot | undefined {
    const id = jobId.trim();
    if (!id) return undefined;
    return this.last.get(id);
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
    this.scheduleCleanup(payload.jobId);
  }

  emitFailed(payload: JobFailedPayload): void {
    this.push({
      jobId: payload.jobId,
      pct: 0,
      label: payload.error.trim() || 'error',
      phase: 'error',
      running: false,
    });
    this.scheduleCleanup(payload.jobId);
  }

  private push(snapshot: AdminJobSnapshot): void {
    this.last.set(snapshot.jobId, snapshot);
    this.getSubject(snapshot.jobId).next(snapshot);
    void this.sseRedis?.publishJob(
      snapshot.jobId,
      snapshot as unknown as Record<string, unknown>,
    );
  }

  private scheduleCleanup(jobId: string): void {
    const id = jobId.trim();
    const prev = this.cleanupTimers.get(id);
    if (prev) clearTimeout(prev);
    const subject = this.subjects.get(id);
    if (subject && !subject.closed) {
      subject.complete();
    }
    this.subjects.delete(id);
    const timer = setTimeout(() => {
      this.last.delete(id);
      this.cleanupTimers.delete(id);
    }, TERMINAL_CLEANUP_MS);
    this.cleanupTimers.set(id, timer);
  }

  private getSubject(jobId: string): Subject<AdminJobSnapshot> {
    let subject = this.subjects.get(jobId);
    if (!subject || subject.closed) {
      subject = new Subject<AdminJobSnapshot>();
      this.subjects.set(jobId, subject);
    }
    return subject;
  }
}
