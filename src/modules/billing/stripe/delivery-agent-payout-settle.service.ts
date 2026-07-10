import { StripeConnectTransferService } from '@modules/billing/stripe/stripe-connect-transfer.service';
import { StripeConnectService } from '@modules/billing/stripe/stripe-connect.service';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';

/**
 * Relance les transfers Connect livreur manqués + settles DIAMOND
 * (solde encore pending juste après confirmation).
 */
@Injectable()
export class DeliveryAgentPayoutSettleService {
  private readonly logger = new Logger(DeliveryAgentPayoutSettleService.name);

  constructor(
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly stripeTransfers: StripeConnectTransferService,
    private readonly stripeConnect: StripeConnectService,
  ) {}

  async runPass(opts?: {
    lookbackDays?: number;
    transferLimit?: number;
    diamondLimit?: number;
  }): Promise<{
    transfersScanned: number;
    transfersSucceeded: number;
    diamondScanned: number;
    diamondSettled: number;
  }> {
    const lookbackDays = Math.max(1, Math.min(opts?.lookbackDays ?? 14, 60));
    const transferLimit = Math.max(1, Math.min(opts?.transferLimit ?? 30, 100));
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const pendingOrders = await this.orderModel
      .find({
        status: OrderStatusEnum.COMPLETED,
        shouldShip: true,
        assignedDeliveryUser: { $exists: true, $ne: null },
        $or: [
          { stripeDeliveryTransferId: { $exists: false } },
          { stripeDeliveryTransferId: null },
          { stripeDeliveryTransferId: '' },
        ],
        updatedAt: { $gte: since },
      })
      .select('_id assignedDeliveryUser')
      .sort({ updatedAt: -1 })
      .limit(transferLimit)
      .lean()
      .exec();

    let transfersSucceeded = 0;
    for (const row of pendingOrders) {
      const orderId = String(row._id);
      try {
        const tr =
          await this.stripeTransfers.transferDeliveryShareForCompletedOrder({
            orderId,
          });
        if (!tr.transferred) {
          if (tr.skippedReason) {
            this.logger.debug(
              `Delivery transfer retry skipped order=${orderId}: ${tr.skippedReason}`,
            );
          }
          continue;
        }
        transfersSucceeded += 1;
        const agentId = row.assignedDeliveryUser
          ? String(row.assignedDeliveryUser)
          : '';
        if (!agentId) continue;
        const agent = await this.userModel.findById(agentId).exec();
        if (!agent || agent.type !== UserTypeEnum.DELIVERY) continue;
        await this.stripeConnect.settlePartnerBadgePayoutAfterTransfer(agent);
      } catch (e) {
        this.logger.warn(
          `Delivery transfer retry failed order=${orderId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    const diamond = await this.stripeConnect.runDiamondPayoutSettlePass({
      limit: opts?.diamondLimit ?? 40,
    });

    return {
      transfersScanned: pendingOrders.length,
      transfersSucceeded,
      diamondScanned: diamond.scanned,
      diamondSettled: diamond.settled,
    };
  }
}
