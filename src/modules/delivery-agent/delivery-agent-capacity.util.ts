import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { PendingDeliveryProofStatusEnum } from '@schemas/pending-delivery-proof.schema';
import { defaultDeliveryCapacity } from './delivery-agent-vehicle.util';
import { Model, Types, type PipelineStage } from 'mongoose';

export type AgentApplicationCapacitySource = {
  vehicle?: string | null;
  maxConcurrentOrders?: number | null;
};

/** Preuves « dépôt fait » : le livreur n’a plus la course en navigation active. */
export const COURIER_DUTY_RELEASED_PROOF_STATUSES: PendingDeliveryProofStatusEnum[] =
  [
    PendingDeliveryProofStatusEnum.SUBMITTED,
    PendingDeliveryProofStatusEnum.CUSTOMER_CONFIRMED,
    PendingDeliveryProofStatusEnum.CUSTOMER_DISPUTED,
    PendingDeliveryProofStatusEnum.ADMIN_APPROVED,
  ];

export function maxConcurrentOrdersFromApplication(
  app: AgentApplicationCapacitySource | null | undefined,
): number {
  const stored = Number(app?.maxConcurrentOrders);
  if (Number.isFinite(stored) && stored >= 1) {
    return Math.trunc(stored);
  }
  return defaultDeliveryCapacity(app?.vehicle);
}

/**
 * Courses SHIPPED encore à livrer (exclut client-absent déjà déposé / validé).
 * `ADMIN_REJECTED` reste compté (nouvelle tentative possible).
 */
export async function countActiveShippedOrdersForAgent(
  orderModel: Model<OrderModel>,
  agentId: Types.ObjectId,
): Promise<number> {
  const result = await orderModel
    .aggregate<{ n: number }>([
      {
        $match: {
          assignedDeliveryUser: agentId,
          shouldShip: true,
          status: OrderStatusEnum.SHIPPED,
        },
      },
      ...courierActiveDutyLookupStages(),
      { $count: 'n' },
    ])
    .exec();
  return result[0]?.n ?? 0;
}

export type AgentOrderRowWithProofRef = {
  /** Lean Mongo peut typers ObjectId en FlattenMaps — on accepte unknown. */
  pendingDeliveryProofId?: unknown;
  pending_delivery_proof_id?: unknown;
};

/** Lit l’id preuve dépôt (camelCase lean ou snake Mongo). */
export function pendingDeliveryProofIdFromRow(
  row: AgentOrderRowWithProofRef,
): string | null {
  const raw = row.pendingDeliveryProofId ?? row.pending_delivery_proof_id;
  if (raw == null) return null;
  const id = String(raw).trim();
  return id.length > 0 ? id : null;
}

/** Filtre post-query les lignes actives (même règle que le count). */
export async function filterCourierActiveShippedRows<
  T extends AgentOrderRowWithProofRef,
>(
  orderModel: Model<OrderModel>,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const proofIds = rows
    .map((row) => pendingDeliveryProofIdFromRow(row))
    .filter((id): id is string => id != null)
    .map((id) => new Types.ObjectId(id));
  if (proofIds.length === 0) return rows;

  const released = await orderModel.db
    .collection('pending_delivery_proofs')
    .find(
      {
        _id: { $in: proofIds },
        status: { $in: COURIER_DUTY_RELEASED_PROOF_STATUSES },
      },
      { projection: { _id: 1 } },
    )
    .toArray();
  const releasedSet = new Set(released.map((doc) => String(doc._id)));
  return rows.filter((row) => {
    const pid = pendingDeliveryProofIdFromRow(row);
    if (pid == null) return true;
    return !releasedSet.has(pid);
  });
}

/**
 * Stages d’agrégation après `$match` shipped+assigned :
 * exclut les courses déjà déposées (client absent).
 *
 * Les docs `orders` en prod stockent souvent le camelCase Nest
 * (`pendingDeliveryProofId`) malgré le `name` snake du schema — on lit les deux.
 */
export function courierActiveDutyLookupStages(): PipelineStage[] {
  return [
    {
      $addFields: {
        _dutyProofId: {
          $ifNull: ['$pendingDeliveryProofId', '$pending_delivery_proof_id'],
        },
      },
    },
    {
      $lookup: {
        from: 'pending_delivery_proofs',
        localField: '_dutyProofId',
        foreignField: '_id',
        as: 'proof',
      },
    },
    {
      $addFields: {
        proofStatus: { $arrayElemAt: ['$proof.status', 0] },
      },
    },
    {
      $match: {
        $or: [
          { proofStatus: { $exists: false } },
          { proofStatus: null },
          {
            proofStatus: {
              $nin: [...COURIER_DUTY_RELEASED_PROOF_STATUSES],
            },
          },
        ],
      },
    },
  ];
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
