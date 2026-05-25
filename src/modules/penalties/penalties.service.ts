import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PenaltyCustomMotifModel } from '@schemas/penalty-custom-motif.schema';
import { PenaltyTransferModel } from '@schemas/penalty-transfer.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { CreatePenaltyCustomMotifDto } from './dto/create-penalty-custom-motif.dto';
import { CreatePenaltyDto } from './dto/create-penalty.dto';
import { PenaltyParticipantEmailService } from './penalty-participant-email.service';
import {
  BUILTIN_PENALTY_REASON_CODES,
  builtinPenaltyReasonLabel,
  isBuiltinPenaltyReasonCode,
  isCustomPenaltyReasonCode,
  PENALTY_REASON_OTHER,
  slugifyPenaltyMotifCode,
} from './penalty-reasons';
import {
  PENALTY_ROUTE_META,
  PenaltyPartyEnum,
  PenaltyRouteEnum,
  PenaltyStatusEnum,
} from './penalty.types';
import { StripePenaltyTransferService } from './stripe-penalty-transfer.service';

function assertAdmin(user: UserModel): void {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class PenaltiesService {
  constructor(
    @InjectModel(PenaltyTransferModel.name)
    private readonly penaltyModel: Model<PenaltyTransferModel>,
    @InjectModel(PenaltyCustomMotifModel.name)
    private readonly customMotifModel: Model<PenaltyCustomMotifModel>,
    private readonly stripePenalties: StripePenaltyTransferService,
    private readonly participantEmails: PenaltyParticipantEmailService,
  ) {}

  listRoutes() {
    return { routes: this.stripePenalties.listRoutes() };
  }

  async listMotifs(user: UserModel) {
    assertAdmin(user);
    const custom = await this.customMotifModel
      .find({ active: true })
      .sort({ labelFr: 1 })
      .lean()
      .exec();
    return {
      builtIn: BUILTIN_PENALTY_REASON_CODES.map((code) => ({
        code,
        labelFr: builtinPenaltyReasonLabel(code) ?? code,
        custom: false,
      })),
      custom: custom.map((m) => ({
        id: String(m._id),
        code: m.code,
        labelFr: m.labelFr,
        custom: true,
      })),
    };
  }

  async createCustomMotif(user: UserModel, dto: CreatePenaltyCustomMotifDto) {
    assertAdmin(user);
    const labelFr = dto.labelFr.trim();
    let code = slugifyPenaltyMotifCode(labelFr);
    const exists = await this.customMotifModel.findOne({ code }).lean().exec();
    if (exists) {
      code = `${code}_${Date.now().toString(36).slice(-4)}`;
    }
    const doc = await this.customMotifModel.create({
      code,
      labelFr,
      active: true,
      createdByAdmin: String(user.id),
    });
    return {
      id: String(doc._id),
      code: doc.code,
      labelFr: doc.labelFr,
      custom: true,
    };
  }

  async list(
    user: UserModel,
    opts?: { page?: number; take?: number; route?: PenaltyRouteEnum },
  ) {
    assertAdmin(user);
    const page = Math.max(1, opts?.page ?? 1);
    const take = Math.min(100, Math.max(1, opts?.take ?? 25));
    const filter: Record<string, unknown> = {};
    if (opts?.route) filter.route = opts.route;

    const [items, total] = await Promise.all([
      this.penaltyModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * take)
        .limit(take)
        .lean()
        .exec(),
      this.penaltyModel.countDocuments(filter).exec(),
    ]);

    return {
      page,
      take,
      total,
      items: items.map((row) => this.toRow(row)),
    };
  }

  async getById(user: UserModel, id: string) {
    assertAdmin(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('invalid_penalty_id');
    }
    const doc = await this.penaltyModel.findById(id).lean().exec();
    if (!doc) throw new NotFoundException('penalty_not_found');
    return this.toRow(doc);
  }

  async createAndExecute(user: UserModel, dto: CreatePenaltyDto) {
    assertAdmin(user);
    this.validateDto(dto);
    const { reasonLabel, reasonDetails } = await this.resolveReason(dto);

    const meta = PENALTY_ROUTE_META[dto.route];
    const notifyParticipants = dto.notifyParticipants !== false;
    const idempotencyKey = dto.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const existing = await this.penaltyModel
        .findOne({ idempotencyKey })
        .lean()
        .exec();
      if (existing) {
        if (existing.status === PenaltyStatusEnum.COMPLETED) {
          return this.toRow(existing);
        }
        throw new ConflictException('penalty_idempotency_in_progress');
      }
    }

    const doc = await this.penaltyModel.create({
      route: dto.route,
      fromParty: meta.from,
      toParty: meta.to,
      amountCents: dto.amountCents,
      currency: (dto.currency ?? 'cad').toLowerCase(),
      status: PenaltyStatusEnum.PROCESSING,
      reasonCode: dto.reasonCode?.trim() || undefined,
      reasonLabel,
      reasonDetails,
      note: dto.note?.trim() || undefined,
      notifyParticipants,
      order: dto.orderId,
      store: dto.storeId,
      vendorUser: dto.vendorUserId,
      deliveryUser: dto.deliveryUserId,
      createdByAdmin: String(user.id),
      idempotencyKey,
      stripeSteps: [],
      participantEmails: [],
    });

    const penaltyId = String(doc._id);

    try {
      const stripeResult = await this.stripePenalties.executeRoute({
        route: dto.route,
        amountCents: dto.amountCents,
        currency: dto.currency,
        orderId: dto.orderId,
        storeId: dto.storeId,
        vendorUserId: dto.vendorUserId,
        deliveryUserId: dto.deliveryUserId,
        penaltyId,
        reasonCode: dto.reasonCode,
      });

      let participantEmails: PenaltyTransferModel['participantEmails'] = [];
      if (notifyParticipants) {
        participantEmails = await this.participantEmails.notifyParticipants({
          route: dto.route,
          fromParty: meta.from,
          toParty: meta.to,
          amountCents: dto.amountCents,
          currency: (dto.currency ?? 'cad').toLowerCase(),
          reasonLabel,
          note: dto.note,
          orderId: dto.orderId,
          storeId: dto.storeId,
          vendorUserId: dto.vendorUserId,
          deliveryUserId: dto.deliveryUserId,
        });
      }

      const updated = await this.penaltyModel
        .findByIdAndUpdate(
          penaltyId,
          {
            $set: {
              status: PenaltyStatusEnum.COMPLETED,
              fromConnectAccountId: stripeResult.fromConnectAccountId,
              toConnectAccountId: stripeResult.toConnectAccountId,
              stripeSteps: stripeResult.steps,
              participantEmails,
              failureCode: null,
              failureMessage: null,
            },
          },
          { new: true },
        )
        .lean()
        .exec();

      return this.toRow(updated!);
    } catch (e) {
      const code =
        e instanceof BadRequestException
          ? String((e.getResponse() as { message?: string | string[] })?.message ?? 'bad_request')
          : 'penalty_execution_failed';
      const msg = e instanceof Error ? e.message : String(e);
      const failed = await this.penaltyModel
        .findByIdAndUpdate(
          penaltyId,
          {
            $set: {
              status: PenaltyStatusEnum.FAILED,
              failureCode: Array.isArray(code) ? code.join(',') : code,
              failureMessage: msg.slice(0, 2000),
            },
          },
          { new: true },
        )
        .lean()
        .exec();
      if (failed) return this.toRow(failed);
      throw e;
    }
  }

  private async resolveReason(
    dto: CreatePenaltyDto,
  ): Promise<{ reasonLabel: string; reasonDetails?: string }> {
    const code = dto.reasonCode?.trim() || '';
    if (!code) {
      throw new BadRequestException('penalty_reason_required');
    }

    if (code === PENALTY_REASON_OTHER) {
      const details = dto.reasonDetails?.trim() || '';
      if (details.length < 10) {
        throw new BadRequestException('penalty_reason_details_required');
      }
      return {
        reasonLabel: details,
        reasonDetails: details,
      };
    }

    const builtin = builtinPenaltyReasonLabel(code);
    if (builtin) {
      return { reasonLabel: builtin };
    }

    if (isCustomPenaltyReasonCode(code)) {
      const custom = await this.customMotifModel
        .findOne({ code, active: true })
        .lean()
        .exec();
      if (!custom) {
        throw new BadRequestException('penalty_custom_motif_not_found');
      }
      return { reasonLabel: custom.labelFr };
    }

    throw new BadRequestException('penalty_reason_code_invalid');
  }

  private validateDto(dto: CreatePenaltyDto): void {
    if (!dto.reasonCode?.trim()) {
      throw new BadRequestException('penalty_reason_required');
    }
    const meta = PENALTY_ROUTE_META[dto.route];
    const needsOrder =
      meta.requiresVendorTransfer || meta.requiresDeliveryTransfer;
    if (needsOrder && !dto.orderId?.trim()) {
      throw new BadRequestException('order_id_required_for_route');
    }

    if (
      meta.from === PenaltyPartyEnum.VENDOR ||
      meta.to === PenaltyPartyEnum.VENDOR
    ) {
      if (!dto.storeId?.trim() && !dto.vendorUserId?.trim()) {
        const needsVendor =
          dto.route === PenaltyRouteEnum.PLATFORM_TO_VENDOR ||
          dto.route === PenaltyRouteEnum.DELIVERY_TO_VENDOR ||
          meta.from === PenaltyPartyEnum.VENDOR;
        if (needsVendor && !dto.orderId) {
          throw new BadRequestException('store_or_vendor_user_required');
        }
      }
    }

    if (
      meta.from === PenaltyPartyEnum.DELIVERY ||
      meta.to === PenaltyPartyEnum.DELIVERY
    ) {
      const needsDeliveryExplicit =
        dto.route === PenaltyRouteEnum.PLATFORM_TO_DELIVERY ||
        (meta.from === PenaltyPartyEnum.DELIVERY &&
          dto.route !== PenaltyRouteEnum.DELIVERY_TO_PLATFORM);
      if (needsDeliveryExplicit && !dto.deliveryUserId?.trim() && !dto.orderId) {
        throw new BadRequestException('delivery_user_required');
      }
    }

    if (
      dto.reasonCode === PENALTY_REASON_OTHER &&
      (dto.reasonDetails?.trim().length ?? 0) < 10
    ) {
      throw new BadRequestException('penalty_reason_details_required');
    }

    if (
      dto.reasonCode?.trim() &&
      !isBuiltinPenaltyReasonCode(dto.reasonCode) &&
      dto.reasonCode !== PENALTY_REASON_OTHER &&
      !isCustomPenaltyReasonCode(dto.reasonCode)
    ) {
      throw new BadRequestException('penalty_reason_code_invalid');
    }
  }

  private toRow(doc: PenaltyTransferModel | Record<string, unknown>) {
    const row = doc as PenaltyTransferModel;
    return {
      id: String(row._id),
      route: row.route,
      fromParty: row.fromParty,
      toParty: row.toParty,
      amountCents: row.amountCents,
      amount: row.amountCents / 100,
      currency: row.currency,
      status: row.status,
      reasonCode: row.reasonCode ?? null,
      reasonLabel: row.reasonLabel ?? null,
      reasonDetails: row.reasonDetails ?? null,
      note: row.note ?? null,
      notifyParticipants: row.notifyParticipants ?? true,
      participantEmails: row.participantEmails ?? [],
      orderId: row.order ? String(row.order) : null,
      storeId: row.store ? String(row.store) : null,
      vendorUserId: row.vendorUser ? String(row.vendorUser) : null,
      deliveryUserId: row.deliveryUser ? String(row.deliveryUser) : null,
      fromConnectAccountId: row.fromConnectAccountId ?? null,
      toConnectAccountId: row.toConnectAccountId ?? null,
      stripeSteps: row.stripeSteps ?? [],
      failureCode: row.failureCode ?? null,
      failureMessage: row.failureMessage ?? null,
      createdByAdminId: row.createdByAdmin ? String(row.createdByAdmin) : null,
      idempotencyKey: row.idempotencyKey ?? null,
      createdAt: row.createdAt?.toISOString?.() ?? null,
      updatedAt: row.updatedAt?.toISOString?.() ?? null,
    };
  }
}
