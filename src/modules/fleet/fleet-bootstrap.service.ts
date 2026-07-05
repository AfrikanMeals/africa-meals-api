import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { maxConcurrentOrdersFromApplication } from '@modules/delivery-agent/delivery-agent-capacity.util';
import { resolveDeliveryAgentPresence } from '@modules/delivery-agent/delivery-agent-domain.util';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { Model, Types } from 'mongoose';
import { FleetSnapshotService } from './fleet-snapshot.service';

@Injectable()
export class FleetBootstrapService {
  private readonly logger = new Logger(FleetBootstrapService.name);

  constructor(
    @InjectModel(DeliveryAgentApplicationModel.name)
    private readonly applications: Model<DeliveryAgentApplicationModel>,
    @InjectModel(OrderModel.name)
    private readonly orders: Model<OrderModel>,
    private readonly fleet: FleetSnapshotService,
  ) {}

  /** Recharge le snapshot fleet depuis Mongo (connexion SSE admin, EDA-007). */
  async refreshFromDatabase(): Promise<void> {
    try {
      const apps = await this.applications
        .find({ status: DeliveryAgentApplicationStatus.APPROVED })
        .select(
          'user lastLatitude lastLongitude dashboardAvailability vehicle maxConcurrentOrders',
        )
        .lean()
        .exec();

      const userIds = apps
        .map((app) => app.user)
        .filter((id) => id != null)
        .map((id) => new Types.ObjectId(String(id)));

      const activeByAgent = new Map<string, number>();
      if (userIds.length) {
        const activeAgg = await this.orders
          .aggregate<{ _id: Types.ObjectId; count: number }>([
            {
              $match: {
                assignedDeliveryUser: { $in: userIds },
                shouldShip: true,
                status: OrderStatusEnum.SHIPPED,
              },
            },
            { $group: { _id: '$assignedDeliveryUser', count: { $sum: 1 } } },
          ])
          .exec();
        for (const row of activeAgg) {
          activeByAgent.set(String(row._id), row.count);
        }
      }

      const rows = apps
        .map((app) => {
          const agentUserId = String(app.user ?? '').trim();
          if (!agentUserId || !Types.ObjectId.isValid(agentUserId)) {
            return null;
          }
          const activeOrderCount = activeByAgent.get(agentUserId) ?? 0;
          const availability =
            app.dashboardAvailability === 'hors_ligne'
              ? 'hors_ligne'
              : 'disponible';
          const presence = resolveDeliveryAgentPresence(
            availability,
            activeOrderCount,
          );
          const lat = Number(app.lastLatitude);
          const lng = Number(app.lastLongitude);
          return {
            agentUserId,
            presence,
            availability,
            activeOrderCount,
            maxConcurrentOrders: maxConcurrentOrdersFromApplication(app),
            ...(Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            !(lat === 0 && lng === 0)
              ? { latitude: lat, longitude: lng }
              : {}),
            updatedAt: new Date().toISOString(),
          };
        })
        .filter((row): row is NonNullable<typeof row> => row != null);

      this.fleet.seedAgents(rows);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Fleet bootstrap failed: ${msg}`);
    }
  }
}
