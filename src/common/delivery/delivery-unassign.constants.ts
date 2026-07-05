/** Motif de retrait livreur (suivi performance + audit). */
export const DELIVERY_UNASSIGN_REASONS = [
  'courier_abandon',
  'vendor_unassign',
  'admin_unassign',
] as const;

export type DeliveryUnassignReason = (typeof DELIVERY_UNASSIGN_REASONS)[number];

export function isDeliveryUnassignReason(
  value: unknown,
): value is DeliveryUnassignReason {
  return (
    typeof value === 'string' &&
    (DELIVERY_UNASSIGN_REASONS as readonly string[]).includes(value)
  );
}
