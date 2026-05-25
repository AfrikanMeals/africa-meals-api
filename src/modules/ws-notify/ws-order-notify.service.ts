import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OrderWsTrackingPayload = {
  orderId: string;
  status: string;
  isPickup: boolean;
  distanceKm?: number;
  progress?: number;
  destinationLine?: string;
  originLine?: string;
  pickupCode?: string;
  courierLatitude?: number;
  courierLongitude?: number;
  remainingDistanceKm?: number;
  elapsedMinutes?: number;
  /** Livreur mobile assigné (`User` DELIVERY) — chat client ↔ livreur. */
  assignedDeliveryUserId?: string;
  canMessageDeliveryAgent?: boolean;
};

/**
 * Pousse `order:update` / `order:tracking` sur le salon Socket.IO `user:{customerId}` (africa-meals-ws).
 */
@Injectable()
export class WsOrderNotifyService {
  private readonly logger = new Logger(WsOrderNotifyService.name);

  constructor(private readonly config: ConfigService) {}

  notifyCustomerOrderUpdate(
    userId: string,
    payload: OrderWsTrackingPayload,
  ): void {
    this.postInternal('order/update', userId, payload);
  }

  notifyCustomerOrderTracking(
    userId: string,
    payload: OrderWsTrackingPayload,
  ): void {
    this.postInternal('order/tracking', userId, payload);
  }

  /** Salon `orders:admin` — comptes ADMIN connectés sur l’app admin. */
  notifyStaffOrderBroadcast(payload: OrderWsTrackingPayload): void {
    this.postInternalStaff('order/staff-broadcast', payload);
  }

  private postInternal(
    pathSuffix: 'order/update' | 'order/tracking',
    userId: string,
    payload: OrderWsTrackingPayload,
  ): void {
    const uid = userId?.trim();
    const orderId = payload.orderId?.trim();
    if (!uid || !orderId) return;

    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim();
    if (!raw || !secret) {
      return;
    }

    const base = raw.replace(/\/+$/, '');
    const path = base.endsWith('/api')
      ? `${base}/internal/${pathSuffix}`
      : `${base}/api/internal/${pathSuffix}`;

    void fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({ userId: uid, ...payload }),
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws order notify (${pathSuffix}) failed: ${msg}`);
    });
  }

  private postInternalStaff(
    pathSuffix: 'order/staff-broadcast',
    payload: OrderWsTrackingPayload,
  ): void {
    const orderId = payload.orderId?.trim();
    if (!orderId) return;

    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim();
    if (!raw || !secret) {
      return;
    }

    const base = raw.replace(/\/+$/, '');
    const path = base.endsWith('/api')
      ? `${base}/internal/${pathSuffix}`
      : `${base}/api/internal/${pathSuffix}`;

    void fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws order notify (${pathSuffix}) failed: ${msg}`);
    });
  }
}
