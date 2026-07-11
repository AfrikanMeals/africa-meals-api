import { UserTypeEnum } from '@schemas/user.schema';

/**
 * Pure helper — destination Connect pour shipping/tip self-delivery vendeur.
 * (miroir de la logique resolveDeliveryPayoutConnectAccount)
 */
export function shouldFallbackDeliveryPayoutToStoreOwner(args: {
  agentReady: boolean;
  agentHasAccount: boolean;
  assigneeType?: string | null;
}): boolean {
  if (args.agentReady && args.agentHasAccount) return false;
  return args.assigneeType === UserTypeEnum.VENDOR;
}
