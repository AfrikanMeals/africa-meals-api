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
import { SharedRedisService } from '../../common/redis/shared-redis.service';

const SSE_CONN_KEY_PREFIX = 'sse:conn:';
const SSE_CONN_TTL_SEC = 3600;

@Injectable()
export class SseStreamService {
  private readonly logger = new Logger(SseStreamService.name);
  private readonly connectionsByUser = new Map<string, number>();
  private seq = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly sharedRedis: SharedRedisService,
  ) {}

  heartbeatMs(): number {
    return parsePositiveInt(this.config.get<string>('SSE_HEARTBEAT_MS'), 20_000);
  }

  maxConnectionsPerUser(): number {
    return parsePositiveInt(
      this.config.get<string>('SSE_MAX_CONNECTIONS_PER_USER'),
      5,
    );
  }

  private async acquireAsync(userId?: string): Promise<() => void> {
    if (!userId) return () => undefined;
    const max = this.maxConnectionsPerUser();
    if (this.sharedRedis.isEnabled()) {
      const key = `${SSE_CONN_KEY_PREFIX}${userId}`;
      const n = await this.sharedRedis.incrWithTtl(key, SSE_CONN_TTL_SEC);
      if (n > max) {
        await this.sharedRedis.decrFloorZero(key);
        throw new ForbiddenException('sse_connection_limit_exceeded');
      }
      return () => {
        void this.sharedRedis.decrFloorZero(key);
      };
    }

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
    const stop$ = new Subject<void>();
    const streamId = ++this.seq;
    let eventId = 0;
    let release: (() => void) | null = null;

    this.logger.debug(`SSE open stream=${opts.eventName} id=${streamId}`);

    return new Observable<MessageEvent>((subscriber) => {
      void this.acquireAsync(opts.userId)
        .then((rel) => {
          release = rel;
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

          const sub = merge(events$, heartbeat$)
            .pipe(
              takeUntil(stop$),
              finalize(() => {
                release?.();
                stop$.complete();
                this.logger.debug(
                  `SSE closed stream=${opts.eventName} id=${streamId}`,
                );
              }),
            )
            .subscribe(subscriber);

          return () => sub.unsubscribe();
        })
        .catch((err) => subscriber.error(err));
    });
  }
}
