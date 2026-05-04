import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { PatchDeliveryAgentApplicationDto } from './dto/delivery-agent-application.dto';

type LeanApp = {
  status: DeliveryAgentApplicationStatus;
  onboardingStep: number;
  vehicle?: string;
  serviceZone?: string;
  termsAccepted: boolean;
  submittedAt?: Date;
  rejectionReason?: string;
  updatedAt?: Date;
};

@Injectable()
export class DeliveryAgentService {
  @InjectModel(DeliveryAgentApplicationModel.name)
  private readonly _applications: Model<DeliveryAgentApplicationModel>;

  assertEligible(user: UserModel) {
    if (
      user.type === UserTypeEnum.VENDOR ||
      user.type === UserTypeEnum.ADMIN
    ) {
      throw new ForbiddenException('delivery_agent_not_available_for_account');
    }
  }

  toPublic(doc: LeanApp | null) {
    if (!doc) {
      return {
        status: DeliveryAgentApplicationStatus.DRAFT,
        onboardingStep: 0,
        vehicle: null as string | null,
        serviceZone: null as string | null,
        termsAccepted: false,
        submittedAt: null as string | null,
        rejectionReason: null as string | null,
        updatedAt: null as string | null,
      };
    }
    return {
      status: doc.status,
      onboardingStep: doc.onboardingStep,
      vehicle: doc.vehicle ?? null,
      serviceZone: doc.serviceZone ?? null,
      termsAccepted: Boolean(doc.termsAccepted),
      submittedAt: doc.submittedAt
        ? new Date(doc.submittedAt).toISOString()
        : null,
      rejectionReason: doc.rejectionReason ?? null,
      updatedAt: doc.updatedAt
        ? new Date(doc.updatedAt).toISOString()
        : null,
    };
  }

  async getOrCreateMine(user: UserModel) {
    this.assertEligible(user);
    const uid = user._id as Types.ObjectId;
    let doc = await this._applications
      .findOne({ user: uid })
      .select(
        'status onboardingStep vehicle serviceZone termsAccepted submittedAt rejectionReason updatedAt',
      )
      .lean<LeanApp>()
      .exec();
    if (!doc) {
      await this._applications.create({
        user: uid,
        status: DeliveryAgentApplicationStatus.DRAFT,
        onboardingStep: 0,
        termsAccepted: false,
      });
      doc = await this._applications
        .findOne({ user: uid })
        .select(
          'status onboardingStep vehicle serviceZone termsAccepted submittedAt rejectionReason updatedAt',
        )
        .lean<LeanApp>()
        .exec();
    }
    return this.toPublic(doc);
  }

  async patchMine(user: UserModel, dto: PatchDeliveryAgentApplicationDto) {
    this.assertEligible(user);
    const uid = user._id as Types.ObjectId;
    const existing = await this._applications.findOne({ user: uid }).exec();
    if (!existing) {
      await this.getOrCreateMine(user);
    }
    const cur = await this._applications.findOne({ user: uid }).exec();
    if (!cur) {
      throw new BadRequestException('delivery_agent_application_missing');
    }
    if (cur.status === DeliveryAgentApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('delivery_agent_application_locked');
    }
    if (cur.status === DeliveryAgentApplicationStatus.APPROVED) {
      throw new BadRequestException('delivery_agent_application_readonly');
    }

    if (cur.status === DeliveryAgentApplicationStatus.REJECTED) {
      cur.status = DeliveryAgentApplicationStatus.DRAFT;
      cur.rejectionReason = undefined;
    }

    if (dto.onboardingStep !== undefined) {
      cur.onboardingStep = dto.onboardingStep;
    }
    if (dto.vehicle !== undefined) {
      cur.vehicle = dto.vehicle;
    }
    if (dto.serviceZone !== undefined) {
      cur.serviceZone = dto.serviceZone.trim();
    }
    if (dto.termsAccepted !== undefined) {
      cur.termsAccepted = dto.termsAccepted;
    }

    await cur.save();
    const lean = await this._applications
      .findOne({ user: uid })
      .select(
        'status onboardingStep vehicle serviceZone termsAccepted submittedAt rejectionReason updatedAt',
      )
      .lean<LeanApp>()
      .exec();
    return this.toPublic(lean);
  }

  async submitMine(user: UserModel) {
    this.assertEligible(user);
    const uid = user._id as Types.ObjectId;
    let cur = await this._applications.findOne({ user: uid }).exec();
    if (!cur) {
      await this.getOrCreateMine(user);
      cur = await this._applications.findOne({ user: uid }).exec();
    }
    if (!cur) {
      throw new BadRequestException('delivery_agent_application_missing');
    }
    if (cur.status === DeliveryAgentApplicationStatus.REJECTED) {
      throw new BadRequestException('delivery_agent_update_after_rejection');
    }
    if (cur.status === DeliveryAgentApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('delivery_agent_already_submitted');
    }
    if (cur.status === DeliveryAgentApplicationStatus.APPROVED) {
      throw new BadRequestException('delivery_agent_already_approved');
    }
    if (!cur.vehicle) {
      throw new BadRequestException('delivery_agent_vehicle_required');
    }
    const zone = (cur.serviceZone ?? '').trim();
    if (zone.length < 5) {
      throw new BadRequestException('delivery_agent_zone_required');
    }
    if (!cur.termsAccepted) {
      throw new BadRequestException('delivery_agent_terms_required');
    }
    cur.serviceZone = zone;
    cur.status = DeliveryAgentApplicationStatus.AWAITING_REVIEW;
    cur.submittedAt = new Date();
    cur.onboardingStep = Math.max(cur.onboardingStep, 2);
    await cur.save();
    const lean = await this._applications
      .findOne({ user: uid })
      .select(
        'status onboardingStep vehicle serviceZone termsAccepted submittedAt rejectionReason updatedAt',
      )
      .lean<LeanApp>()
      .exec();
    return this.toPublic(lean);
  }
}
