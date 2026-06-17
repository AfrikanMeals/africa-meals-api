import { Injectable, Optional } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { SseRedisPublishService } from '../../common/sse/sse-redis-publish.service';

export type CheckoutSessionEvent = {
  type: 'checkout_completed' | 'subscription_completed';
  sessionId: string;
  orderIds?: string[];
  complete?: boolean;
};

const TERMINAL_CLEANUP_MS = 30 * 60 * 1000;

@Injectable()
export class CheckoutSessionSseService {
  private readonly subjects = new Map<string, Subject<CheckoutSessionEvent>>();
  private readonly last = new Map<string, CheckoutSessionEvent>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Optional() private readonly sseRedis?: SseRedisPublishService,
  ) {}

  observe(sessionId: string): Observable<CheckoutSessionEvent> {
    const id = sessionId.trim();
    return new Observable((subscriber) => {
      const cached = this.last.get(id);
      if (cached) subscriber.next(cached);
      const subject = this.getSubject(id);
      const sub = subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }

  emit(sessionId: string, event: CheckoutSessionEvent): void {
    const id = sessionId.trim();
    if (!id) return;
    this.last.set(id, event);
    this.getSubject(id).next(event);
    void this.sseRedis?.publishCheckout(
      id,
      event as unknown as Record<string, unknown>,
    );
    if (
      event.type === 'checkout_completed' ||
      event.type === 'subscription_completed'
    ) {
      this.scheduleCleanup(id);
    }
  }

  private scheduleCleanup(sessionId: string): void {
    const prev = this.cleanupTimers.get(sessionId);
    if (prev) clearTimeout(prev);
    const subject = this.subjects.get(sessionId);
    if (subject && !subject.closed) {
      subject.complete();
    }
    this.subjects.delete(sessionId);
    const timer = setTimeout(() => {
      this.last.delete(sessionId);
      this.cleanupTimers.delete(sessionId);
    }, TERMINAL_CLEANUP_MS);
    this.cleanupTimers.set(sessionId, timer);
  }

  private getSubject(sessionId: string): Subject<CheckoutSessionEvent> {
    let subject = this.subjects.get(sessionId);
    if (!subject || subject.closed) {
      subject = new Subject<CheckoutSessionEvent>();
      this.subjects.set(sessionId, subject);
    }
    return subject;
  }
}
