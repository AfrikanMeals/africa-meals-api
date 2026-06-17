import {
  ForbiddenException,
  Injectable,
  Logger,
  MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject, merge, interval, finalize } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { parsePositiveInt } from '../../common/bullmq-redis-connection';

@Injectable()
export class SseStreamService {
  private readonly logger = new Logger(SseStreamService.name);
  private readonly connectionsByUser = new Map<string, number>();
  private seq = 0;

  constructor(private readonly config: ConfigService) {}

  heartbeatMs(): number {
    return parsePositiveInt(this.config.get<string>('SSE_HEARTBEAT_MS'), 20_000);
  }

  maxConnectionsPerUser(): number {
    return parsePositiveInt(
      this.config.get<string>('SSE_MAX_CONNECTIONS_PER_USER'),
      5,
    );
  }

  private acquire(userId?: string): () => void {
    if (!userId) return () => undefined;
    const max = this.maxConnectionsPerUser();
    const count = this.connectionsByUser.get(userId) ?? 0;
    if (count >= max) {
      throw new ForbiddenException('sse_connection_limit_exceeded');
    }
    this.connectionsByUser.set(userId, count + 1);
    return () => {
      const next = (this.connectionsByUser.get(userId) ?? 1) - 1;
      if (next <= 0) this.connectionsByUser.delete(userId);
      else this.connectionsByUser.set(userId, next);
    };
  }

  /**
   * Fusionne un flux métier + heartbeats ; libère le slot connexion à la fin.
   */
  stream<T extends Record<string, unknown>>(opts: {
    userId?: string;
    eventName: string;
    source$: Observable<T>;
    completeWhen?: (payload: T) => boolean;
  }): Observable<MessageEvent> {
    const release = this.acquire(opts.userId);
    const stop$ = new Subject<void>();
    const streamId = ++this.seq;
    let eventId = 0;

    this.logger.debug(`SSE open stream=${opts.eventName} id=${streamId}`);

    const events$ = opts.source$.pipe(
      map((payload): MessageEvent => {
        eventId += 1;
        if (opts.completeWhen?.(payload)) {
          queueMicrotask(() => stop$.next());
        }
        return {
          id: String(eventId),
          type: opts.eventName,
          data: payload,
        };
      }),
    );

    const heartbeat$ = interval(this.heartbeatMs()).pipe(
      map((): MessageEvent => {
        eventId += 1;
        return {
          id: String(eventId),
          type: 'heartbeat',
          data: { ts: new Date().toISOString() },
        };
      }),
    );

    return merge(events$, heartbeat$).pipe(
      takeUntil(stop$),
      finalize(() => {
        release();
        stop$.complete();
        this.logger.debug(`SSE closed stream=${opts.eventName} id=${streamId}`);
      }),
    );
  }
}
