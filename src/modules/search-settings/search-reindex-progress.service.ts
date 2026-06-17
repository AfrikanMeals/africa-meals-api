import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type SearchReindexPhase = 'stores' | 'products' | 'drinks' | 'complete' | 'error';

export type SearchReindexProgressEvent = {
  phase: SearchReindexPhase;
  current: number;
  total: number;
  pct: number;
  label: string;
  message?: string;
  running: boolean;
};

const IDLE: SearchReindexProgressEvent = {
  phase: 'complete',
  current: 0,
  total: 0,
  pct: 0,
  label: 'idle',
  running: false,
};

@Injectable()
export class SearchReindexProgressService {
  private readonly subject = new Subject<SearchReindexProgressEvent>();
  private last: SearchReindexProgressEvent = IDLE;

  observe(): Observable<SearchReindexProgressEvent> {
    return new Observable((subscriber) => {
      subscriber.next(this.last);
      const sub = this.subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }

  snapshot(): SearchReindexProgressEvent {
    return this.last;
  }

  emit(event: SearchReindexProgressEvent): void {
    this.last = event;
    this.subject.next(event);
  }

  resetIdle(): void {
    this.emit(IDLE);
  }
}
