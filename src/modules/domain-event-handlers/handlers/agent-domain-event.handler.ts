import { Injectable, Logger } from '@nestjs/common';
import { DomainEventEnvelope } from '../../../common/domain-events/domain-event.types';
import {
  AgentCapacityChangedPayload,
  AgentLocationUpdatedPayload,
  AgentPresenceChangedPayload,
} from '../../../common/domain-events/payloads/agent-domain-event.payloads';
import { FleetSnapshotService } from '@modules/fleet/fleet-snapshot.service';

@Injectable()
export class AgentDomainEventHandler {
  private readonly logger = new Logger(AgentDomainEventHandler.name);

  constructor(private readonly fleet: FleetSnapshotService) {}

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'agent.presence.changed':
        await this.onPresence(
          envelope.payload as AgentPresenceChangedPayload,
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

  private async onPresence(_payload: AgentPresenceChangedPayload): Promise<void> {
    // Fleet + WS temps réel : dispatch synchrone depuis DeliveryAgentService.
  }

  private async onLocation(_payload: AgentLocationUpdatedPayload): Promise<void> {
    // GPS fleet : dispatch synchrone depuis DeliveryAgentService.
  }

  private async onCapacity(payload: AgentCapacityChangedPayload): Promise<void> {
    this.fleet.pushAgentUpdate({
      agentUserId: payload.agentUserId,
      maxConcurrentOrders: payload.maxConcurrentOrders,
    });
  }
}
