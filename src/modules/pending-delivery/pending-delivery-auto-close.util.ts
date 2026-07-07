import { PendingDeliveryProofStatusEnum } from '@schemas/pending-delivery-proof.schema';

export const PENDING_DELIVERY_DEFAULT_AUTO_CLOSE_DAYS = 7;

export function pendingDeliveryAutoCloseDaysFromEnv(
  raw: string | undefined,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return PENDING_DELIVERY_DEFAULT_AUTO_CLOSE_DAYS;
  }
  return Math.floor(parsed);
}

export function isPendingDeliveryAutoCloseEligible(args: {
  status: PendingDeliveryProofStatusEnum;
  createdAt: Date | string | null | undefined;
  now?: Date;
  autoCloseDays?: number;
}): boolean {
  if (args.status !== PendingDeliveryProofStatusEnum.SUBMITTED) {
    return false;
  }
  if (!args.createdAt) return false;
  const created =
    args.createdAt instanceof Date
      ? args.createdAt
      : new Date(String(args.createdAt));
  if (Number.isNaN(created.getTime())) return false;
  const days = args.autoCloseDays ?? PENDING_DELIVERY_DEFAULT_AUTO_CLOSE_DAYS;
  const cutoff = (args.now ?? new Date()).getTime() - days * 24 * 60 * 60 * 1000;
  return created.getTime() <= cutoff;
}
