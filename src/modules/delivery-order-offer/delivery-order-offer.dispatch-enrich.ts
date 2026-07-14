import { predictDeliveryEta } from '@common/eta-engine.util';
import { courierActiveDutyLookupStages } from '@modules/delivery-agent/delivery-agent-capacity.util';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { Model, Types } from 'mongoose';
import { haversineMeters } from './delivery-order-offer.ranking';
import type { DeliveryOfferCandidateInput } from './delivery-order-offer.ranking';

/**
 * Durée route restante (s) par livreur — somme `courierRouteDurationS`
 * des courses SHIPPED encore en duty.
 */
export async function loadRouteRemainingSecondsByAgent(
  orderModel: Model<OrderModel>,
  agentUserIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const oids = agentUserIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  if (oids.length === 0) return out;

  const rows = await orderModel
    .aggregate<{
      agentId: Types.ObjectId;
      routeSeconds: number;
    }>([
      {
        $match: {
          assignedDeliveryUser: { $in: oids },
          shouldShip: true,
          status: OrderStatusEnum.SHIPPED,
        },
      },
      ...courierActiveDutyLookupStages(),
      {
        $group: {
          _id: '$assignedDeliveryUser',
          routeSeconds: {
            $sum: {
              $max: [
                0,
                {
                  $ifNull: [
                    '$courierRouteDurationS',
                    { $ifNull: ['$courier_route_duration_s', 0] },
                  ],
                },
              ],
            },
          },
        },
      },
      {
        $project: {
          agentId: '$_id',
          routeSeconds: { $round: ['$routeSeconds', 0] },
        },
      },
    ])
    .exec();

  for (const row of rows) {
    const id = String(row.agentId);
    const s = Number(row.routeSeconds);
    if (id && Number.isFinite(s) && s > 0) {
      out.set(id, Math.round(s));
    }
  }
  return out;
}

/**
 * Délai prédit (min) pour une offre : trajet livreur→boutique→client
 * via ETA engine (trafic optionnel).
 */
export function predictOfferDelayMinutes(opts: {
  storeLngLat: [number, number] | null;
  deliveryLngLat?: [number, number] | null;
  distanceToStoreMeters?: number | null;
  courierLat?: number | null;
  courierLng?: number | null;
  trafficFactor?: number | null;
  restaurantPrepMinutes?: number | null;
}): number {
  const store = opts.storeLngLat;
  let toStoreM =
    opts.distanceToStoreMeters != null &&
    Number.isFinite(opts.distanceToStoreMeters)
      ? Math.max(0, Number(opts.distanceToStoreMeters))
      : null;

  if (
    toStoreM == null &&
    store &&
    opts.courierLat != null &&
    opts.courierLng != null &&
    Number.isFinite(opts.courierLat) &&
    Number.isFinite(opts.courierLng)
  ) {
    toStoreM = haversineMeters(store, [
      Number(opts.courierLng),
      Number(opts.courierLat),
    ]);
  }

  let storeToClientM = 0;
  if (store && opts.deliveryLngLat) {
    storeToClientM = haversineMeters(store, opts.deliveryLngLat);
  }

  const totalKm =
    ((toStoreM ?? 0) + storeToClientM) / 1000 ||
    (storeToClientM > 0 ? storeToClientM / 1000 : 0);

  if (totalKm <= 0 && toStoreM == null) return 0;

  const pred = predictDeliveryEta({
    distanceKm: Math.max(0.1, totalKm),
    trafficFactor: opts.trafficFactor ?? 1,
    restaurantPrepMinutes: opts.restaurantPrepMinutes ?? 0,
    alreadyPickedUp: false,
  });
  // Score dispatch : trajet + prep + surplus trafic (pas seulement hist delay).
  return Math.max(
    0,
    Math.round(
      pred.travelMinutes +
        pred.pickupDelayMinutes +
        pred.deliveryDelayMinutes,
    ),
  );
}

/**
 * Enrichit les candidats soft (route + délai) avant ranking composite.
 */
export function applyDispatchEnrichment(
  inputs: DeliveryOfferCandidateInput[],
  opts: {
    routeByAgent: Map<string, number>;
    storeLngLat: [number, number] | null;
    deliveryLngLat?: [number, number] | null;
    trafficFactor?: number | null;
    restaurantPrepMinutes?: number | null;
  },
): void {
  for (const input of inputs) {
    const routeS = opts.routeByAgent.get(input.agentUserId);
    if (routeS != null && routeS > 0) {
      input.routeRemainingSeconds = routeS;
    }
    input.predictedDelayMinutes = predictOfferDelayMinutes({
      storeLngLat: opts.storeLngLat,
      deliveryLngLat: opts.deliveryLngLat,
      distanceToStoreMeters: input.geoDistanceMeters ?? null,
      courierLat: input.lastLatitude,
      courierLng: input.lastLongitude,
      trafficFactor: opts.trafficFactor,
      restaurantPrepMinutes: opts.restaurantPrepMinutes,
    });
  }
}
