import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEventEnvelope } from '../../../common/domain-events/domain-event.types';
import {
  AgentCapacityChangedPayload,
  AgentLocationUpdatedPayload,
  AgentPresenceChangedPayload,
} from '../../../common/domain-events/payloads/agent-domain-event.payloads';
import { WsDeliveryAgentNotifyService } from '@modules/ws-notify/ws-delivery-agent-notify.service';
import { FleetSnapshotService } from '@modules/fleet/fleet-snapshot.service';
import { isDomainEventsWsViaBus } from '../domain-event-handlers.util';

@Injectable()
export class AgentDomainEventHandler {
  private readonly logger = new Logger(AgentDomainEventHandler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly wsDeliveryAgent: WsDeliveryAgentNotifyService,
    private readonly fleet: FleetSnapshotService,
  ) {}

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'agent.presence.changed':
        await this.onPresence(
          envelope.payload as AgentPresenceChangedPayload,
          envelope.metadata,
        );
        break;
      case 'agent.location.updated':
        await this.onLocation(envelope.payload as AgentLocationUpdatedPayload);
        break;
      case 'agent.capacity.changed':
        await this.onCapacity(envelope.payload as AgentCapacityChangedPayload);
        break;
      default:
        break;
    }
  }

  private async onPresence(
    payload: AgentPresenceChangedPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    const availability: 'disponible' | 'hors_ligne' =
      payload.presence === 'offline' ? 'hors_ligne' : 'disponible';
    const presence =
      payload.presence === 'busy'
        ? 'en_livraison'
        : payload.presence === 'available'
          ? 'disponible'
          : 'hors_ligne';
    const maxConcurrentOrders = Number(
      metadata?.orderContext?.maxConcurrentOrders,
    );
    const reason = (metadata?.orderContext?.reason ??
      'manual_toggle') as
      | 'manual_toggle'
      | 'order_assigned'
      | 'order_completed'
      | 'admin_toggle';
    if (!isDomainEventsWsViaBus(this.config)) {
      this.wsDeliveryAgent.notifyPresence({
        agentUserId: payload.agentUserId,
        availability,
        presence,
        activeOrderCount: payload.activeOrderCount ?? 0,
        maxConcurrentOrders:
          Number.isFinite(maxConcurrentOrders) && maxConcurrentOrders >= 1
            ? maxConcurrentOrders
            : 1,
        reason,
      });
    }
    this.fleet.pushAgentUpdate({
      agentUserId: payload.agentUserId,
      presence,
      availability,
      activeOrderCount: payload.activeOrderCount,
      latitude: undefined,
      longitude: undefined,
    });
  }

  private async onLocation(payload: AgentLocationUpdatedPayload): Promise<void> {
    this.fleet.pushAgentUpdate({
      agentUserId: payload.agentUserId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      orderId: payload.orderId,
    });
  }

  private async onCapacity(payload: AgentCapacityChangedPayload): Promise<void> {
    this.fleet.pushAgentUpdate({
      agentUserId: payload.agentUserId,
      maxConcurrentOrders: payload.maxConcurrentOrders,
    });
  }
}
