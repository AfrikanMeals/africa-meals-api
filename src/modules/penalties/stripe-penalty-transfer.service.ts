import { isStripeConnectOnboardingCompleteUser } from '@modules/billing/stripe/stripe-connect-visibility';
import { StripeChargeFeeService } from '@modules/billing/stripe/stripe-charge-fee.service';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import {
  PenaltyPartyEnum,
  PenaltyRouteEnum,
  PenaltyStripeStepKindEnum,
  PENALTY_ROUTE_META,
} from './penalty.types';

type StripeClient = InstanceType<typeof Stripe>;

export type PenaltyStripeStepResult = {
  kind: PenaltyStripeStepKindEnum;
  stripeId: string;
  amountCents: number;
  connectAccountId?: string;
};

export type ExecutePenaltyStripeResult = {
  steps: PenaltyStripeStepResult[];
  fromConnectAccountId?: string;
  toConnectAccountId?: string;
};

@Injectable()
export class StripePenaltyTransferService {
  private readonly logger = new Logger(StripePenaltyTransferService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly stripeFees: StripeChargeFeeService,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
  ) {}

  penaltiesEnabled(): boolean {
    const raw = this.config.get<string>('STRIPE_PENALTIES_ENABLED');
    if (raw === '0' || raw === 'false') return false;
    return true;
  }

  private stripe(): StripeClient {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new BadRequestException('stripe_not_configured');
    }
    return new Stripe(key);
  }

  private currency(raw?: string): string {
    return (
      raw?.trim().toLowerCase() ||
      this.config
        .get<string>('STRIPE_CONNECT_TRANSFER_CURRENCY')
        ?.trim()
        .toLowerCase() ||
      'cad'
    );
  }

  async resolveVendorConnectAccount(args: {
    storeId?: string;
    vendorUserId?: string;
  }): Promise<{ accountId: string; storeId?: string; vendorUserId?: string }> {
    let ownerId = args.vendorUserId?.trim() || '';
    const storeId = args.storeId?.trim() || '';

    if (storeId && Types.ObjectId.isValid(storeId)) {
      const store = await this.storeModel
        .findById(storeId)
        .select('owner')
        .lean()
        .exec();
      if (!store?.owner) {
        throw new BadRequestException('store_owner_not_found');
      }
      ownerId = String(store.owner);
    }

    if (!ownerId || !Types.ObjectId.isValid(ownerId)) {
      throw new BadRequestException('vendor_user_required');
    }

    const owner = await this.userModel
      .findById(ownerId)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
      .lean()
      .exec();
    const accountId = owner?.stripeConnectAccountId?.trim() || '';
    if (!accountId || !isStripeConnectOnboardingCompleteUser(owner)) {
      throw new BadRequestException('vendor_connect_onboarding_incomplete');
    }
    return {
      accountId,
      storeId: storeId || undefined,
      vendorUserId: ownerId,
    };
  }

  async resolveDeliveryConnectAccount(
    deliveryUserId: string,
  ): Promise<{ accountId: string; deliveryUserId: string }> {
    if (!Types.ObjectId.isValid(deliveryUserId)) {
      throw new BadRequestException('invalid_delivery_user_id');
    }
    const agent = await this.userModel
      .findById(deliveryUserId)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
      .lean()
      .exec();
    const accountId = agent?.stripeConnectAccountId?.trim() || '';
    if (!accountId || !isStripeConnectOnboardingCompleteUser(agent)) {
      throw new BadRequestException('delivery_connect_onboarding_incomplete');
    }
    return { accountId, deliveryUserId };
  }

  private async loadOrderForPenalty(orderId: string) {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('invalid_order_id');
    }
    const order = await this.orderModel
      .findById(orderId)
      .select(
        'store assignedDeliveryUser stripeParentPaymentId stripeTransferId stripeTransferAmountCents stripeTransferReversalAmountCents stripeDeliveryTransferId stripeDeliveryTransferAmountCents stripeDeliveryTransferReversalAmountCents',
      )
      .lean()
      .exec();
    if (!order) {
      throw new BadRequestException('order_not_found');
    }
    return order;
  }

  /**
   * Exécute le flux Stripe pour une route de pénalité (après validation métier).
   */
  async executeRoute(args: {
    route: PenaltyRouteEnum;
    amountCents: number;
    currency?: string;
    orderId?: string;
    storeId?: string;
    vendorUserId?: string;
    deliveryUserId?: string;
    penaltyId: string;
    reasonCode?: string;
  }): Promise<ExecutePenaltyStripeResult> {
    if (!this.penaltiesEnabled()) {
      throw new BadRequestException('stripe_penalties_disabled');
    }

    const meta = PENALTY_ROUTE_META[args.route];
    const currency = this.currency(args.currency);
    const amountCents = Math.max(1, Math.round(args.amountCents));

    switch (args.route) {
      case PenaltyRouteEnum.PLATFORM_TO_VENDOR: {
        const vendor = await this.resolveVendorConnectAccount({
          storeId: args.storeId,
          vendorUserId: args.vendorUserId,
        });
        const step = await this.transferFromPlatform({
          destinationAccountId: vendor.accountId,
          amountCents,
          currency,
          idempotencyKey: `penalty-${args.penaltyId}-to-vendor`,
          metadata: this.baseMetadata(args, 'platform_to_vendor'),
        });
        return {
          steps: [step],
          toConnectAccountId: vendor.accountId,
        };
      }

      case PenaltyRouteEnum.PLATFORM_TO_DELIVERY: {
        const deliveryUserId = args.deliveryUserId?.trim();
        if (!deliveryUserId) {
          throw new BadRequestException('delivery_user_required');
        }
        const delivery = await this.resolveDeliveryConnectAccount(
          deliveryUserId,
        );
        const step = await this.transferFromPlatform({
          destinationAccountId: delivery.accountId,
          amountCents,
          currency,
          idempotencyKey: `penalty-${args.penaltyId}-to-delivery`,
          metadata: this.baseMetadata(args, 'platform_to_delivery'),
        });
        return {
          steps: [step],
          toConnectAccountId: delivery.accountId,
        };
      }

      case PenaltyRouteEnum.VENDOR_TO_PLATFORM: {
        const orderId = args.orderId?.trim();
        if (!orderId) {
          throw new BadRequestException('order_id_required_for_route');
        }
        const order = await this.loadOrderForPenalty(orderId);
        const vendor = await this.resolveVendorConnectAccount({
          storeId:
            args.storeId || (order.store ? String(order.store) : undefined),
          vendorUserId: args.vendorUserId,
        });
        const step = await this.reverseTransferToPlatform({
          transferId: order.stripeTransferId,
          transferAmountCents: order.stripeTransferAmountCents,
          alreadyReversedCents: order.stripeTransferReversalAmountCents,
          amountCents,
          orderId,
          idempotencyKey: `penalty-${args.penaltyId}-vendor-reversal`,
          metadata: this.baseMetadata(args, 'vendor_to_platform'),
        });
        return {
          steps: [step],
          fromConnectAccountId: vendor.accountId,
        };
      }

      case PenaltyRouteEnum.DELIVERY_TO_PLATFORM: {
        const orderId = args.orderId?.trim();
        if (!orderId) {
          throw new BadRequestException('order_id_required_for_route');
        }
        const order = await this.loadOrderForPenalty(orderId);
        const agentId =
          args.deliveryUserId?.trim() ||
          (order.assignedDeliveryUser
            ? String(order.assignedDeliveryUser)
            : '');
        if (!agentId) {
          throw new BadRequestException('delivery_user_required');
        }
        const delivery = await this.resolveDeliveryConnectAccount(agentId);
        const step = await this.reverseTransferToPlatform({
          transferId: order.stripeDeliveryTransferId,
          transferAmountCents: order.stripeDeliveryTransferAmountCents,
          alreadyReversedCents: order.stripeDeliveryTransferReversalAmountCents,
          amountCents,
          orderId,
          idempotencyKey: `penalty-${args.penaltyId}-delivery-reversal`,
          metadata: this.baseMetadata(args, 'delivery_to_platform'),
          orderUpdateField: 'delivery',
        });
        return {
          steps: [step],
          fromConnectAccountId: delivery.accountId,
        };
      }

      case PenaltyRouteEnum.VENDOR_TO_DELIVERY: {
        return this.executeVendorToDelivery(args, amountCents, currency);
      }

      case PenaltyRouteEnum.DELIVERY_TO_VENDOR: {
        return this.executeDeliveryToVendor(args, amountCents, currency);
      }

      default:
        throw new BadRequestException('penalty_route_unsupported');
    }
  }

  private async executeVendorToDelivery(
    args: {
      route: PenaltyRouteEnum;
      orderId?: string;
      storeId?: string;
      vendorUserId?: string;
      deliveryUserId?: string;
      penaltyId: string;
      reasonCode?: string;
    },
    amountCents: number,
    currency: string,
  ): Promise<ExecutePenaltyStripeResult> {
    const orderId = args.orderId?.trim();
    if (!orderId) {
      throw new BadRequestException('order_id_required_for_route');
    }
    const order = await this.loadOrderForPenalty(orderId);
    const vendor = await this.resolveVendorConnectAccount({
      storeId: args.storeId || (order.store ? String(order.store) : undefined),
      vendorUserId: args.vendorUserId,
    });
    const agentId =
      args.deliveryUserId?.trim() ||
      (order.assignedDeliveryUser ? String(order.assignedDeliveryUser) : '');
    if (!agentId) {
      throw new BadRequestException('delivery_user_required');
    }
    const delivery = await this.resolveDeliveryConnectAccount(agentId);

    const reversal = await this.reverseTransferToPlatform({
      transferId: order.stripeTransferId,
      transferAmountCents: order.stripeTransferAmountCents,
      alreadyReversedCents: order.stripeTransferReversalAmountCents,
      amountCents,
      orderId,
      idempotencyKey: `penalty-${args.penaltyId}-v2d-reversal`,
      metadata: this.baseMetadata(args, 'vendor_to_delivery_reversal'),
    });

    const parentId = String(order.stripeParentPaymentId ?? '').trim();
    const chargeId = parentId
      ? await this.stripeFees.resolveChargeId(parentId)
      : null;

    const transfer = await this.transferFromPlatform({
      destinationAccountId: delivery.accountId,
      amountCents: reversal.amountCents,
      currency,
      idempotencyKey: `penalty-${args.penaltyId}-v2d-transfer`,
      sourceTransaction: chargeId ?? undefined,
      transferGroup: parentId || undefined,
      metadata: {
        ...this.baseMetadata(args, 'vendor_to_delivery_transfer'),
        vendorUserId: vendor.vendorUserId ?? '',
        agentUserId: delivery.deliveryUserId,
      },
    });

    return {
      steps: [reversal, transfer],
      fromConnectAccountId: vendor.accountId,
      toConnectAccountId: delivery.accountId,
    };
  }

  private async executeDeliveryToVendor(
    args: {
      orderId?: string;
      storeId?: string;
      vendorUserId?: string;
      deliveryUserId?: string;
      penaltyId: string;
      reasonCode?: string;
    },
    amountCents: number,
    currency: string,
  ): Promise<ExecutePenaltyStripeResult> {
    const orderId = args.orderId?.trim();
    if (!orderId) {
      throw new BadRequestException('order_id_required_for_route');
    }
    const order = await this.loadOrderForPenalty(orderId);
    const vendor = await this.resolveVendorConnectAccount({
      storeId: args.storeId || (order.store ? String(order.store) : undefined),
      vendorUserId: args.vendorUserId,
    });
    const agentId =
      args.deliveryUserId?.trim() ||
      (order.assignedDeliveryUser ? String(order.assignedDeliveryUser) : '');
    if (!agentId) {
      throw new BadRequestException('delivery_user_required');
    }
    const delivery = await this.resolveDeliveryConnectAccount(agentId);

    const reversal = await this.reverseTransferToPlatform({
      transferId: order.stripeDeliveryTransferId,
      transferAmountCents: order.stripeDeliveryTransferAmountCents,
      alreadyReversedCents: order.stripeDeliveryTransferReversalAmountCents,
      amountCents,
      orderId,
      idempotencyKey: `penalty-${args.penaltyId}-d2v-reversal`,
      metadata: this.baseMetadata(
        { ...args, route: PenaltyRouteEnum.DELIVERY_TO_VENDOR },
        'delivery_to_vendor_reversal',
      ),
      orderUpdateField: 'delivery',
    });

    const parentId = String(order.stripeParentPaymentId ?? '').trim();
    const chargeId = parentId
      ? await this.stripeFees.resolveChargeId(parentId)
      : null;

    const transfer = await this.transferFromPlatform({
      destinationAccountId: vendor.accountId,
      amountCents: reversal.amountCents,
      currency,
      idempotencyKey: `penalty-${args.penaltyId}-d2v-transfer`,
      sourceTransaction: chargeId ?? undefined,
      transferGroup: parentId || undefined,
      metadata: {
        ...this.baseMetadata(
          { ...args, route: PenaltyRouteEnum.DELIVERY_TO_VENDOR },
          'delivery_to_vendor_transfer',
        ),
        vendorUserId: vendor.vendorUserId ?? '',
        agentUserId: delivery.deliveryUserId,
      },
    });

    return {
      steps: [reversal, transfer],
      fromConnectAccountId: delivery.accountId,
      toConnectAccountId: vendor.accountId,
    };
  }

  private baseMetadata(
    args: {
      penaltyId: string;
      route: PenaltyRouteEnum;
      orderId?: string;
      reasonCode?: string;
    },
    step: string,
  ): Record<string, string> {
    return {
      platform: 'wise-eat',
      transferKind: 'penalty',
      penaltyId: args.penaltyId,
      penaltyRoute: args.route,
      penaltyStep: step,
      ...(args.orderId ? { orderId: args.orderId } : {}),
      ...(args.reasonCode ? { reasonCode: args.reasonCode } : {}),
    };
  }

  private async transferFromPlatform(args: {
    destinationAccountId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
    sourceTransaction?: string;
    transferGroup?: string;
  }): Promise<PenaltyStripeStepResult> {
    const transfer = await this.stripe().transfers.create(
      {
        amount: args.amountCents,
        currency: args.currency,
        destination: args.destinationAccountId,
        ...(args.sourceTransaction
          ? { source_transaction: args.sourceTransaction }
          : {}),
        ...(args.transferGroup ? { transfer_group: args.transferGroup } : {}),
        metadata: args.metadata,
      },
      { idempotencyKey: args.idempotencyKey },
    );
    this.logger.log(
      `Penalty transfer ${transfer.id}: ${args.amountCents / 100} ${
        args.currency
      } → ${args.destinationAccountId}`,
    );
    return {
      kind: PenaltyStripeStepKindEnum.TRANSFER,
      stripeId: transfer.id,
      amountCents: args.amountCents,
      connectAccountId: args.destinationAccountId,
    };
  }

  private async reverseTransferToPlatform(args: {
    transferId?: string | null;
    transferAmountCents?: number | null;
    alreadyReversedCents?: number | null;
    amountCents: number;
    orderId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
    orderUpdateField?: 'vendor' | 'delivery';
  }): Promise<PenaltyStripeStepResult> {
    const transferId = args.transferId?.trim();
    if (!transferId) {
      throw new BadRequestException('order_transfer_missing');
    }
    const transferred = Math.max(0, Number(args.transferAmountCents ?? 0));
    const alreadyReversed = Math.max(0, Number(args.alreadyReversedCents ?? 0));
    const remaining = transferred - alreadyReversed;
    if (remaining < 1) {
      throw new BadRequestException('order_transfer_fully_reversed');
    }
    const reversalCents = Math.min(args.amountCents, remaining);

    const reversal = await this.stripe().transfers.createReversal(
      transferId,
      {
        amount: reversalCents,
        metadata: args.metadata,
      },
      { idempotencyKey: args.idempotencyKey },
    );

    const newReversedTotal = alreadyReversed + reversalCents;
    const update =
      args.orderUpdateField === 'delivery'
        ? {
            stripeDeliveryTransferReversalId: reversal.id,
            stripeDeliveryTransferReversalAmountCents: newReversedTotal,
          }
        : {
            stripeTransferReversalId: reversal.id,
            stripeTransferReversalAmountCents: newReversedTotal,
          };

    await this.orderModel.updateOne({ _id: args.orderId }, { $set: update });

    this.logger.log(
      `Penalty reversal ${reversal.id}: ${
        reversalCents / 100
      } on ${transferId} (order ${args.orderId})`,
    );

    return {
      kind: PenaltyStripeStepKindEnum.TRANSFER_REVERSAL,
      stripeId: reversal.id,
      amountCents: reversalCents,
    };
  }

  listRoutes(): Array<{
    route: PenaltyRouteEnum;
    from: PenaltyPartyEnum;
    to: PenaltyPartyEnum;
    requiresOrderId: boolean;
    usesPlatformBalance: boolean;
    descriptionFr: string;
  }> {
    const descriptions: Record<PenaltyRouteEnum, string> = {
      [PenaltyRouteEnum.VENDOR_TO_PLATFORM]:
        'Récupère des fonds du compte vendeur vers la plateforme (reversal du transfer commande).',
      [PenaltyRouteEnum.DELIVERY_TO_PLATFORM]:
        'Récupère des fonds du livreur vers la plateforme (reversal transfer livraison).',
      [PenaltyRouteEnum.VENDOR_TO_DELIVERY]:
        'Reverse la part vendeur puis verse au livreur (hub plateforme, même commande).',
      [PenaltyRouteEnum.DELIVERY_TO_VENDOR]:
        'Reverse la part livraison puis verse au vendeur.',
      [PenaltyRouteEnum.PLATFORM_TO_VENDOR]:
        'Compensation / bonus : transfert depuis le solde plateforme vers le vendeur.',
      [PenaltyRouteEnum.PLATFORM_TO_DELIVERY]:
        'Compensation livreur depuis le solde plateforme.',
    };
    return Object.values(PenaltyRouteEnum).map((route) => {
      const meta = PENALTY_ROUTE_META[route];
      return {
        route,
        from: meta.from,
        to: meta.to,
        requiresOrderId: Boolean(
          meta.requiresVendorTransfer || meta.requiresDeliveryTransfer,
        ),
        usesPlatformBalance: Boolean(meta.usesPlatformBalance),
        descriptionFr: descriptions[route],
      };
    });
  }
}
