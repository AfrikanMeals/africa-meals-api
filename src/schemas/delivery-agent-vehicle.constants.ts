export const DELIVERY_AGENT_VEHICLE_TYPES = [
  'pied',
  'velo',
  'tricycle',
  'scooter',
  'moto',
  'voiture',
  'van',
] as const;

export type DeliveryAgentVehicle =
  (typeof DELIVERY_AGENT_VEHICLE_TYPES)[number];
