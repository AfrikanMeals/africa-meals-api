import { DeliveryAgentVehicle } from '@schemas/delivery-agent-application.schema';

export type DeliveryVehicleLabelFr = 'Moto' | 'Vélo' | 'Voiture';

export function deliveryVehicleLabelFr(
  vehicle?: DeliveryAgentVehicle | string | null,
): DeliveryVehicleLabelFr {
  switch (vehicle) {
    case 'velo':
      return 'Vélo';
    case 'voiture':
      return 'Voiture';
    case 'moto':
    default:
      return 'Moto';
  }
}

/** Capacité par défaut selon le type de véhicule (commandes simultanées). */
export function defaultDeliveryCapacity(
  vehicle?: DeliveryAgentVehicle | string | null,
): number {
  switch (vehicle) {
    case 'velo':
      return 1;
    case 'moto':
      return 2;
    case 'voiture':
      return 4;
    default:
      return 2;
  }
}

export function normalizeVehicleRegistration(
  vehicle: DeliveryAgentVehicle | string | undefined,
  raw?: string | null,
): string | null {
  const t = (raw ?? '').trim();
  if (vehicle === 'velo') {
    return t.length > 0 ? t : null;
  }
  return t.length > 0 ? t : null;
}

export function vehicleRegistrationRequired(
  vehicle?: DeliveryAgentVehicle | string | null,
): boolean {
  return vehicle === 'moto' || vehicle === 'voiture';
}
