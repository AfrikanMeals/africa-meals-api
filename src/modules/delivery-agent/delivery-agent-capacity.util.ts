import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { defaultDeliveryCapacity } from './delivery-agent-vehicle.util';
import { Model, Types } from 'mongoose';

export type AgentApplicationCapacitySource = {
  vehicle?: string | null;
  maxConcurrentOrders?: number | null;
};

export function maxConcurrentOrdersFromApplication(
  app: AgentApplicationCapacitySource | null | undefined,
): number {
  const stored = Number(app?.maxConcurrentOrders);
  if (Number.isFinite(stored) && stored >= 1) {
    return Math.trunc(stored);
  }
  return defaultDeliveryCapacity(app?.vehicle);
}

export async function countActiveShippedOrdersForAgent(
  orderModel: Model<OrderModel>,
  agentId: Types.ObjectId,
): Promise<number> {
  return orderModel.countDocuments({
    assignedDeliveryUser: agentId,
    shouldShip: true,
    status: OrderStatusEnum.SHIPPED,
  });
}

export async function agentHasDeliveryCapacity(
  orderModel: Model<OrderModel>,
  app: AgentApplicationCapacitySource | null | undefined,
  agentId: Types.ObjectId,
): Promise<{ allowed: boolean; activeCount: number; capacity: number }> {
  const activeCount = await countActiveShippedOrdersForAgent(orderModel, agentId);
  const capacity = maxConcurrentOrdersFromApplication(app);
  return {
    allowed: activeCount < capacity,
    activeCount,
    capacity,
  };
}
