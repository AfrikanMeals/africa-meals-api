import { MailerService } from '@modules/mailer/mailer.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { penaltyRouteLabelFr } from './penalty-display.util';
import { PenaltyPartyEnum, PenaltyRouteEnum } from './penalty.types';

export type PenaltyEmailLogEntry = {
  party: PenaltyPartyEnum;
  role: 'from' | 'to' | 'participant';
  email: string;
  name: string;
  sent: boolean;
  error?: string;
};

@Injectable()
export class PenaltyParticipantEmailService {
  private readonly logger = new Logger(PenaltyParticipantEmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
  ) {}

  async notifyParticipants(args: {
    route: PenaltyRouteEnum;
    fromParty: PenaltyPartyEnum;
    toParty: PenaltyPartyEnum;
    amountCents: number;
    currency: string;
    reasonLabel: string;
    note?: string;
    orderId?: string;
    storeId?: string;
    vendorUserId?: string;
    deliveryUserId?: string;
  }): Promise<PenaltyEmailLogEntry[]> {
    const recipients = await this.resolveRecipients(args);
    if (!recipients.length) return [];

    const appName =
      this.config.get<string>('APP_NAME')?.trim() || 'Afrika Meals';
    const amountStr = `${(args.amountCents / 100).toFixed(
      2,
    )} ${args.currency.toUpperCase()}`;
    const routeLabel = penaltyRouteLabelFr(args.route);
    const orderRef = args.orderId
      ? await this.orderDisplayRef(args.orderId)
      : null;

    const logs: PenaltyEmailLogEntry[] = [];

    for (const r of recipients) {
      const subject = `${appName} — Mouvement financier (${routeLabel})`;
      const lines = [
        `Un mouvement financier a été enregistré sur votre compte.`,
        ``,
        `Montant : ${amountStr}`,
        `Type : ${routeLabel}`,
        `Motif : ${args.reasonLabel}`,
      ];
      if (orderRef) lines.push(`Commande : ${orderRef}`);
      if (args.note?.trim()) lines.push(`Note : ${args.note.trim()}`);
      lines.push(
        ``,
        `Pour toute question, contactez le support.`,
        `— L’équipe ${appName}`,
      );
      const text = lines.join('\n');
      const html = lines
        .map((line) =>
          line === '' ? '<br/>' : `<p>${this.escapeHtml(line)}</p>`,
        )
        .join('\n');

      try {
        await this.mailer.sendSimple({
          to: r.email,
          toName: r.name,
          subject,
          html: `<div>${html}</div>`,
          text,
        });
        logs.push({
          party: r.party,
          role: r.role,
          email: r.email,
          name: r.name,
          sent: true,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`penalty email ${r.email}: ${msg}`);
        logs.push({
          party: r.party,
          role: r.role,
          email: r.email,
          name: r.name,
          sent: false,
          error: msg.slice(0, 500),
        });
      }
    }

    return logs;
  }

  private async resolveRecipients(args: {
    route: PenaltyRouteEnum;
    fromParty: PenaltyPartyEnum;
    toParty: PenaltyPartyEnum;
    storeId?: string;
    vendorUserId?: string;
    deliveryUserId?: string;
  }): Promise<
    Array<{
      party: PenaltyPartyEnum;
      role: 'from' | 'to';
      email: string;
      name: string;
    }>
  > {
    const parties = new Set<PenaltyPartyEnum>();
    if (args.fromParty !== PenaltyPartyEnum.PLATFORM)
      parties.add(args.fromParty);
    if (args.toParty !== PenaltyPartyEnum.PLATFORM) parties.add(args.toParty);

    const out: Array<{
      party: PenaltyPartyEnum;
      role: 'from' | 'to';
      email: string;
      name: string;
    }> = [];

    let vendorUserId = args.vendorUserId?.trim() || '';
    const deliveryUserId = args.deliveryUserId?.trim() || '';

    if (args.storeId?.trim()) {
      const store = await this.storeModel
        .findById(args.storeId)
        .select('owner email name')
        .lean()
        .exec();
      if (store?.owner && !vendorUserId) {
        vendorUserId = String(store.owner);
      }
      if (parties.has(PenaltyPartyEnum.VENDOR)) {
        const ownerRow = vendorUserId
          ? await this.userEmailRow(vendorUserId)
          : null;
        const email = ownerRow?.email || store?.email?.trim() || '';
        if (email) {
          out.push({
            party: PenaltyPartyEnum.VENDOR,
            role: args.fromParty === PenaltyPartyEnum.VENDOR ? 'from' : 'to',
            email,
            name: ownerRow?.name || store?.name?.trim() || 'Restaurant',
          });
          parties.delete(PenaltyPartyEnum.VENDOR);
        }
      }
    }

    if (parties.has(PenaltyPartyEnum.VENDOR) && vendorUserId) {
      const row = await this.userEmailRow(vendorUserId);
      if (row) {
        out.push({
          party: PenaltyPartyEnum.VENDOR,
          role: args.fromParty === PenaltyPartyEnum.VENDOR ? 'from' : 'to',
          email: row.email,
          name: row.name,
        });
        parties.delete(PenaltyPartyEnum.VENDOR);
      }
    }

    if (parties.has(PenaltyPartyEnum.DELIVERY) && deliveryUserId) {
      const row = await this.userEmailRow(deliveryUserId);
      if (row) {
        out.push({
          party: PenaltyPartyEnum.DELIVERY,
          role: args.fromParty === PenaltyPartyEnum.DELIVERY ? 'from' : 'to',
          ...row,
        });
      }
    }

    const seen = new Set<string>();
    return out.filter((r) => {
      const key = r.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async userEmailRow(
    userId: string,
  ): Promise<{ email: string; name: string } | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const u = await this.userModel
      .findById(userId)
      .select('fullName email')
      .lean()
      .exec();
    const email = u?.email?.trim();
    if (!email) return null;
    return {
      email,
      name: u?.fullName?.trim() || 'Bonjour',
    };
  }

  private async userDisplayName(userId: string): Promise<string> {
    const row = await this.userEmailRow(userId);
    return row?.name ?? '';
  }

  private async orderDisplayRef(orderId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(orderId)) return null;
    const o = await this.orderModel
      .findById(orderId)
      .select('_id')
      .lean()
      .exec();
    if (!o) return null;
    const tail = String(o._id).slice(-6).toUpperCase();
    return `#AE-${tail}`;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
