import { DeliveryAgentVehicle } from '@schemas/delivery-agent-vehicle.constants';

export type DeliveryVehicleLabelFr =
  | 'À pied'
  | 'Vélo'
  | 'Tricycle'
  | 'Scooter'
  | 'Moto'
  | 'Voiture'
  | 'Fourgonnette';

export function deliveryVehicleLabelFr(
  vehicle?: DeliveryAgentVehicle | string | null,
): DeliveryVehicleLabelFr {
  switch (vehicle) {
    case 'pied':
      return 'À pied';
    case 'velo':
      return 'Vélo';
    case 'tricycle':
      return 'Tricycle';
    case 'scooter':
      return 'Scooter';
    case 'voiture':
      return 'Voiture';
    case 'van':
      return 'Fourgonnette';
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
    case 'pied':
    case 'velo':
      return 1;
    case 'tricycle':
    case 'scooter':
    case 'moto':
      return 2;
    case 'voiture':
      return 4;
    case 'van':
      return 6;
    default:
      return 2;
  }
}

export function normalizeVehicleRegistration(
  vehicle: DeliveryAgentVehicle | string | undefined,
  raw?: string | null,
): string | null {
  const t = (raw ?? '').trim();
  if (!vehicleRegistrationRequired(vehicle)) {
    return t.length > 0 ? t : null;
  }
  return t.length > 0 ? t : null;
}

export function vehicleRegistrationRequired(
  vehicle?: DeliveryAgentVehicle | string | null,
): boolean {
  return (
    vehicle === 'scooter' ||
    vehicle === 'moto' ||
    vehicle === 'voiture' ||
    vehicle === 'van'
  );
}

export function driverLicenseRequired(
  vehicle?: DeliveryAgentVehicle | string | null,
): boolean {
  return vehicleRegistrationRequired(vehicle);
}
