import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type CheckoutSessionEvent = {
  type: 'checkout_completed' | 'subscription_completed';
  sessionId: string;
  orderIds?: string[];
  complete?: boolean;
};

@Injectable()
export class CheckoutSessionSseService {
  private readonly subjects = new Map<string, Subject<CheckoutSessionEvent>>();

  observe(sessionId: string): Observable<CheckoutSessionEvent> {
    const id = sessionId.trim();
    return new Observable((subscriber) => {
      const subject = this.getSubject(id);
      const sub = subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }

  emit(sessionId: string, event: CheckoutSessionEvent): void {
    const id = sessionId.trim();
    if (!id) return;
    this.getSubject(id).next(event);
  }

  private getSubject(sessionId: string): Subject<CheckoutSessionEvent> {
    let subject = this.subjects.get(sessionId);
    if (!subject) {
      subject = new Subject<CheckoutSessionEvent>();
      this.subjects.set(sessionId, subject);
    }
    return subject;
  }
}
