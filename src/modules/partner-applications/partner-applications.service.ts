import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PartnerApplicationModel,
  PartnerApplicationStatus,
} from '@schemas/partner-application.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { PartnerSubscriptionsService } from '@modules/partner-subscriptions/partner-subscriptions.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { PartnerOnboardingEmailService } from '@modules/vendor-emails/partner-onboarding-email.service';
import {
  isEligibleForPartnerApplication,
  resolvePartnerSuspendRestoreType,
} from './partner-application-eligibility.util';
import {
  PatchPartnerApplicationDto,
} from './dto/partner-application.dto';
import {
  generatePartnerReferralCode,
  normalizePartnerReferralCode,
} from './partner-referral-code.util';

type LeanApp = {
  _id?: Types.ObjectId;
  user?: Types.ObjectId;
  status: PartnerApplicationStatus;
  onboardingStep: number;
  organizationName?: string;
  region?: string;
  collaborationNotes?: string;
  termsAccepted: boolean;
  submittedAt?: Date;
  rejectionReason?: string;
  referralCode?: string;
  previousUserType?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

const APPLICATION_PUBLIC_SELECT =
  'status onboardingStep organizationName region collaborationNotes termsAccepted submittedAt rejectionReason referralCode previousUserType updatedAt createdAt user';

/** Tentatives max avant d’abandonner (collision index unique rare). */
const REFERRAL_CODE_ALLOC_ATTEMPTS = 12;

@Injectable()
export class PartnerApplicationsService {
  private readonly _logger = new Logger(PartnerApplicationsService.name);

  constructor(
    @InjectModel(PartnerApplicationModel.name)
    private readonly _applications: Model<PartnerApplicationModel>,
    @InjectModel(UserModel.name)
    private readonly _users: Model<UserModel>,
    @Inject(SupportedCountriesService)
    private readonly _supportedCountries: SupportedCountriesService,
    private readonly _partnerOnboardingEmail: PartnerOnboardingEmailService,
    private readonly _partnerSubscriptions: PartnerSubscriptionsService,
  ) {}

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  /** Lecture / édition candidature : éligibles ou déjà PARTNER (suivi dossier). */
  private assertCanAccessOwnApplication(user: UserModel) {
    if (user.type === UserTypeEnum.ADMIN) {
      throw new ForbiddenException('partner_application_not_available_for_account');
    }
    if (
      user.type === UserTypeEnum.PARTNER ||
      isEligibleForPartnerApplication(user.type)
    ) {
      return;
    }
    throw new ForbiddenException('partner_application_not_available_for_account');
  }

  /** Création / patch / submit : uniquement comptes éligibles (pas encore PARTNER). */
  private assertEligibleToApply(user: UserModel) {
    if (!isEligibleForPartnerApplication(user.type)) {
      throw new ForbiddenException('partner_application_not_available_for_account');
    }
  }

  private defaultRegionForUser(user: UserModel): string {
    const raw = (
      (user as UserModel & { appCountryCode?: string }).appCountryCode ?? 'CA'
    )
      .trim()
      .toUpperCase();
    return raw.length === 2 ? raw : 'CA';
  }

  private async assertOperatingRegionSupported(region: string): Promise<void> {
    const code = region.trim().toUpperCase();
    if (code.length !== 2) {
      throw new BadRequestException('partner_application_region_required');
    }
    const activeCodes = new Set(
      (await this._supportedCountries.listActive()).map((x) =>
        String(x.code ?? '')
          .trim()
          .toUpperCase(),
      ),
    );
    if (activeCodes.size > 0 && !activeCodes.has(code)) {
      throw new BadRequestException('partner_application_region_unsupported');
    }
  }

  toPublic(doc: LeanApp | null) {
    if (!doc) {
      return {
        status: PartnerApplicationStatus.DRAFT,
        onboardingStep: 0,
        organizationName: null as string | null,
        region: null as string | null,
        collaborationNotes: null as string | null,
        termsAccepted: false,
        submittedAt: null as string | null,
        rejectionReason: null as string | null,
        referralCode: null as string | null,
        updatedAt: null as string | null,
      };
    }
    return {
      status: doc.status,
      onboardingStep: doc.onboardingStep,
      organizationName: doc.organizationName?.trim() || null,
      region: doc.region?.trim().toUpperCase() || null,
      collaborationNotes: doc.collaborationNotes?.trim() || null,
      termsAccepted: Boolean(doc.termsAccepted),
      submittedAt: doc.submittedAt
        ? new Date(doc.submittedAt).toISOString()
        : null,
      rejectionReason: doc.rejectionReason ?? null,
      referralCode: normalizePartnerReferralCode(doc.referralCode),
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    };
  }

  async getOrCreateMine(user: UserModel) {
    this.assertCanAccessOwnApplication(user);
    const uid = user._id as Types.ObjectId;
    let app = await this._applications.findOne({ user: uid }).exec();

    // PARTNER signup sans candidature Mongo : créer fiche APPROVED + code referral.
    // Fix: avant, réponse virtuelle `referralCode: null` → chip header invisible.
    if (!app && user.type === UserTypeEnum.PARTNER) {
      app = await this._applications.create({
        user: uid,
        status: PartnerApplicationStatus.APPROVED,
        onboardingStep: 2,
        termsAccepted: true,
        region: this.defaultRegionForUser(user),
      });
      await this.allocateReferralCodeIfNeeded(app);
      await app.save();
      return this.toPublic(app.toObject() as LeanApp);
    }

    if (!app) {
      this.assertEligibleToApply(user);
      const defaultRegion = this.defaultRegionForUser(user);
      await this._applications.create({
        user: uid,
        status: PartnerApplicationStatus.DRAFT,
        onboardingStep: 0,
        termsAccepted: false,
        region: defaultRegion,
      });
      app = await this._applications.findOne({ user: uid }).exec();
    }

    // Backfill code si Partner actif sans referral (approbation legacy / race).
    if (
      app &&
      user.type === UserTypeEnum.PARTNER &&
      !normalizePartnerReferralCode(app.referralCode)
    ) {
      await this.allocateReferralCodeIfNeeded(app);
      await app.save();
    }

    return this.toPublic(
      app ? (app.toObject() as LeanApp) : null,
    );
  }

  async patchMine(user: UserModel, dto: PatchPartnerApplicationDto) {
    this.assertEligibleToApply(user);
    const uid = user._id as Types.ObjectId;
    const existing = await this._applications.findOne({ user: uid }).exec();
    if (!existing) {
      await this.getOrCreateMine(user);
    }
    const cur = await this._applications.findOne({ user: uid }).exec();
    if (!cur) {
      throw new BadRequestException('partner_application_missing');
    }
    if (cur.status === PartnerApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('partner_application_locked');
    }
    if (cur.status === PartnerApplicationStatus.APPROVED) {
      throw new BadRequestException('partner_application_readonly');
    }
    if (cur.status === PartnerApplicationStatus.SUSPENDED) {
      throw new BadRequestException('partner_account_suspended');
    }

    // Après refus : repasser en brouillon pour permettre une nouvelle soumission.
    if (cur.status === PartnerApplicationStatus.REJECTED) {
      cur.status = PartnerApplicationStatus.DRAFT;
      cur.rejectionReason = undefined;
    }

    if (dto.onboardingStep !== undefined) {
      cur.onboardingStep = dto.onboardingStep;
    }
    if (dto.organizationName !== undefined) {
      const name = dto.organizationName.trim();
      cur.organizationName = name.length > 0 ? name : undefined;
    }
    if (dto.region !== undefined) {
      const next = dto.region.trim().toUpperCase();
      await this.assertOperatingRegionSupported(next);
      cur.region = next;
    }
    if (dto.collaborationNotes !== undefined) {
      cur.collaborationNotes = dto.collaborationNotes.trim();
    }
    if (dto.termsAccepted !== undefined) {
      cur.termsAccepted = dto.termsAccepted;
    }

    await cur.save();
    const lean = await this._applications
      .findOne({ user: uid })
      .select(APPLICATION_PUBLIC_SELECT)
      .lean<LeanApp>()
      .exec();
    return this.toPublic(lean);
  }

  async submitMine(user: UserModel) {
    this.assertEligibleToApply(user);
    const uid = user._id as Types.ObjectId;
    let cur = await this._applications.findOne({ user: uid }).exec();
    if (!cur) {
      await this.getOrCreateMine(user);
      cur = await this._applications.findOne({ user: uid }).exec();
    }
    if (!cur) {
      throw new BadRequestException('partner_application_missing');
    }
    if (cur.status === PartnerApplicationStatus.REJECTED) {
      throw new BadRequestException('partner_application_update_after_rejection');
    }
    if (cur.status === PartnerApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('partner_application_already_submitted');
    }
    if (cur.status === PartnerApplicationStatus.APPROVED) {
      throw new BadRequestException('partner_application_already_approved');
    }
    if (cur.status === PartnerApplicationStatus.SUSPENDED) {
      throw new BadRequestException('partner_account_suspended');
    }

    const region = (cur.region ?? '').trim().toUpperCase();
    if (region.length !== 2) {
      throw new BadRequestException('partner_application_region_required');
    }
    await this.assertOperatingRegionSupported(region);
    cur.region = region;

    const notes = (cur.collaborationNotes ?? '').trim();
    if (notes.length < 10) {
      throw new BadRequestException('partner_application_notes_required');
    }
    cur.collaborationNotes = notes;

    if (!cur.termsAccepted) {
      throw new BadRequestException('partner_application_terms_required');
    }
    const phone = (user.phoneNumber ?? '').trim();
    if (phone.length < 8) {
      throw new BadRequestException('partner_application_phone_required');
    }
    const name = (user.fullName ?? '').trim();
    if (name.length < 2) {
      throw new BadRequestException('partner_application_name_required');
    }

    cur.status = PartnerApplicationStatus.AWAITING_REVIEW;
    cur.submittedAt = new Date();
    cur.onboardingStep = Math.max(cur.onboardingStep, 2);
    await cur.save();

    const lean = await this._applications
      .findOne({ user: uid })
      .select(APPLICATION_PUBLIC_SELECT)
      .lean<LeanApp>()
      .exec();
    return this.toPublic(lean);
  }

  /**
   * Sync Collaborations après soumission fiche partenaire (candidats).
   * Remplace le formulaire Become Partner : notes dérivées de la fiche.
   */
  async enqueueCollaborationsReviewFromProfile(
    user: UserModel,
    args: {
      organizationName: string;
      collaborationNotes: string;
      regionCode?: string | null;
    },
  ): Promise<void> {
    // PARTNER déjà actif : pas de file Collaborations.
    if (user.type === UserTypeEnum.PARTNER) return;
    this.assertEligibleToApply(user);

    const uid = user._id as Types.ObjectId;
    let cur = await this._applications.findOne({ user: uid }).exec();
    if (!cur) {
      await this._applications.create({
        user: uid,
        status: PartnerApplicationStatus.DRAFT,
        onboardingStep: 0,
        termsAccepted: false,
        region: this.defaultRegionForUser(user),
      });
      cur = await this._applications.findOne({ user: uid }).exec();
    }
    if (!cur) {
      throw new BadRequestException('partner_application_missing');
    }
    // Dossier déjà approuvé / suspendu : ne pas écraser.
    if (
      cur.status === PartnerApplicationStatus.APPROVED ||
      cur.status === PartnerApplicationStatus.SUSPENDED
    ) {
      return;
    }

    const regionRaw = String(args.regionCode ?? cur.region ?? '')
      .trim()
      .toUpperCase();
    const region =
      regionRaw.length === 2 ? regionRaw : this.defaultRegionForUser(user);
    await this.assertOperatingRegionSupported(region);

    const notes = String(args.collaborationNotes ?? '').trim();
    if (notes.length < 10) {
      throw new BadRequestException('partner_application_notes_required');
    }
    const org = String(args.organizationName ?? '').trim();

    cur.region = region;
    cur.organizationName = org.length > 0 ? org.slice(0, 120) : undefined;
    cur.collaborationNotes = notes.slice(0, 1000);
    cur.termsAccepted = true;
    cur.status = PartnerApplicationStatus.AWAITING_REVIEW;
    cur.submittedAt = new Date();
    cur.onboardingStep = Math.max(cur.onboardingStep, 2);
    cur.rejectionReason = undefined;
    await cur.save();
    this._logger.log(
      `partner_application_from_profile user=${String(uid)} status=AWAITING_REVIEW`,
    );
  }

  private mapAdminRow(
    doc: LeanApp,
    user?: {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      profileImage?: string;
      type?: string;
    },
  ) {
    const pub = this.toPublic(doc);
    const profile = (user?.profileImage ?? '').trim();
    return {
      ...pub,
      id: String(doc._id),
      userId: String(doc.user),
      userFullName: String(user?.fullName ?? '').trim(),
      userEmail: String(user?.email ?? '').trim(),
      userPhone: String(user?.phoneNumber ?? '').trim(),
      userProfileImageUrl: profile.length > 0 ? profile : null,
      userType: String(user?.type ?? ''),
      previousUserType: doc.previousUserType ?? null,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    };
  }

  async listApplicationsAdmin(user: UserModel, statusFilter?: string) {
    this.assertAdmin(user);
    const filter: Record<string, unknown> = {};
    const status = (statusFilter ?? '').trim().toUpperCase();
    if (
      status &&
      Object.values(PartnerApplicationStatus).includes(
        status as PartnerApplicationStatus,
      )
    ) {
      filter.status = status;
    }
    const rows = await this._applications
      .find(filter)
      .sort({ submittedAt: -1, updatedAt: -1, createdAt: -1 })
      .lean<LeanApp[]>()
      .exec();

    const userIds = [
      ...new Set(
        rows
          .map((r) => String(r.user))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const users = await this._users
      .find({ _id: { $in: userIds } })
      .select('fullName email phoneNumber profileImage type')
      .lean()
      .exec();
    const userById = new Map(
      users.map((u) => [String(u._id), u as Record<string, unknown>]),
    );

    return rows.map((r) =>
      this.mapAdminRow(
        r,
        userById.get(String(r.user)) as {
          fullName?: string;
          email?: string;
          phoneNumber?: string;
          type?: string;
        },
      ),
    );
  }

  /**
   * Attribue un code referral unique 6 chars si absent.
   * Réutilise le code existant (réactivation / re-approve).
   */
  private async allocateReferralCodeIfNeeded(
    app: PartnerApplicationModel,
  ): Promise<string> {
    const existing = normalizePartnerReferralCode(app.referralCode);
    if (existing) return existing;

    for (let attempt = 0; attempt < REFERRAL_CODE_ALLOC_ATTEMPTS; attempt++) {
      const candidate = generatePartnerReferralCode();
      const clash = await this._applications
        .exists({ referralCode: candidate })
        .exec();
      if (clash) continue;
      app.referralCode = candidate;
      return candidate;
    }
    throw new BadRequestException('partner_application_referral_code_alloc_failed');
  }

  /**
   * Lecture batch userId → code (liste fiches Collaborations).
   * Absent / invalide → null (pas d’allocation).
   */
  async mapReferralCodesByUserIds(
    userIds: string[],
  ): Promise<Map<string, string | null>> {
    const valid = [
      ...new Set(userIds.filter((id) => Types.ObjectId.isValid(id))),
    ];
    const out = new Map<string, string | null>();
    for (const id of valid) out.set(id, null);
    if (!valid.length) return out;

    const apps = await this._applications
      .find({ user: { $in: valid.map((id) => new Types.ObjectId(id)) } })
      .select('user referralCode')
      .lean<{ user?: Types.ObjectId; referralCode?: string }[]>()
      .exec();
    for (const app of apps) {
      out.set(
        String(app.user ?? ''),
        normalizePartnerReferralCode(app.referralCode),
      );
    }
    return out;
  }

  /**
   * Sync Collaborations après approve fiche (candidat → PARTNER).
   * Idempotent si déjà APPROVED ; ne touche pas SUSPENDED.
   */
  async syncApprovedFromProfileReview(args: {
    userId: string;
    previousUserType: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(args.userId)) return;
    const uid = new Types.ObjectId(args.userId);
    const agentUser = await this._users.findById(uid).exec();
    if (!agentUser) return;

    let app = await this._applications.findOne({ user: uid }).exec();
    // Fiche seule sans ligne Collaborations : créer APPROVED (lookup referral).
    if (!app) {
      await this._applications.create({
        user: uid,
        status: PartnerApplicationStatus.APPROVED,
        onboardingStep: 2,
        termsAccepted: true,
        region: this.defaultRegionForUser(agentUser),
        previousUserType: args.previousUserType,
        submittedAt: new Date(),
      });
      this._logger.log(
        `partner_application_created_from_profile_approve user=${args.userId}`,
      );
      return;
    }
    // Ne pas écraser une suspension Collaborations.
    if (app.status === PartnerApplicationStatus.SUSPENDED) return;

    if (!app.previousUserType) {
      app.previousUserType = args.previousUserType;
    }
    app.status = PartnerApplicationStatus.APPROVED;
    app.rejectionReason = undefined;
    app.termsAccepted = true;
    app.onboardingStep = Math.max(app.onboardingStep ?? 0, 2);
    if (!app.submittedAt) app.submittedAt = new Date();
    await app.save();
    this._logger.log(
      `partner_application_synced_approved_from_profile user=${args.userId}`,
    );
  }

  /**
   * Admin — garantit ou définit un code referral pour un user Partner.
   * - `desiredCode` renseigné → valide format + unicité (hors ce user), puis assigne.
   * - sinon → alloue auto si absent (idempotent si déjà présent).
   */
  async ensureReferralCodeForUserAdmin(
    admin: UserModel,
    userId: string,
    desiredCode?: string | null,
  ): Promise<{
    referralCode: string;
    previousReferralCode: string | null;
    /** True si la valeur stockée a changé (1ʳᵉ alloc ou remplacement). */
    newlyAllocated: boolean;
  }> {
    this.assertAdmin(admin);
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('user_not_found');
    }
    const uid = new Types.ObjectId(userId);
    const agentUser = await this._users.findById(uid).exec();
    if (!agentUser) {
      throw new NotFoundException('user_not_found');
    }

    let app = await this._applications.findOne({ user: uid }).exec();
    // PARTNER sans ligne partner_applications (signup / fiche seule).
    if (!app) {
      app = await this._applications.create({
        user: uid,
        status: PartnerApplicationStatus.APPROVED,
        onboardingStep: 2,
        termsAccepted: true,
        region: this.defaultRegionForUser(agentUser),
      });
    }

    const rawDesired = String(desiredCode ?? '').trim();
    // Admin a saisi un code : format strict + collision DB.
    if (rawDesired) {
      const desired = normalizePartnerReferralCode(rawDesired);
      if (!desired) {
        throw new BadRequestException('partner_referral_code_invalid');
      }
      const clash = await this._applications
        .findOne({
          referralCode: desired,
          user: { $ne: uid },
        })
        .select('_id')
        .lean()
        .exec();
      if (clash) {
        throw new BadRequestException('partner_referral_code_taken');
      }
      const previous = normalizePartnerReferralCode(app.referralCode);
      app.referralCode = desired;
      // Partner actif : aligner candidature sur APPROVED pour lookup / attach.
      if (
        agentUser.type === UserTypeEnum.PARTNER &&
        app.status !== PartnerApplicationStatus.APPROVED &&
        app.status !== PartnerApplicationStatus.SUSPENDED
      ) {
        app.status = PartnerApplicationStatus.APPROVED;
      }
      await app.save();
      this._logger.log(
        `partner_referral_set user=${userId} code=${desired} changed=${
          previous !== desired
        }`,
      );
      return {
        referralCode: desired,
        previousReferralCode: previous,
        newlyAllocated: previous !== desired,
      };
    }

    const previous = normalizePartnerReferralCode(app.referralCode);
    const hadCode = Boolean(previous);
    const referralCode = await this.allocateReferralCodeIfNeeded(app);
    // Fix: après approve fiche (type → PARTNER), aligner Collaborations APPROVED
    // même sans nouveau code (sinon reste AWAITING_REVIEW).
    let statusAligned = false;
    if (
      agentUser.type === UserTypeEnum.PARTNER &&
      app.status !== PartnerApplicationStatus.APPROVED &&
      app.status !== PartnerApplicationStatus.SUSPENDED
    ) {
      app.status = PartnerApplicationStatus.APPROVED;
      statusAligned = true;
    }
    if (!hadCode || statusAligned) {
      await app.save();
    }

    this._logger.log(
      `partner_referral_ensure user=${userId} code=${referralCode} newly=${!hadCode}`,
    );
    return {
      referralCode,
      previousReferralCode: previous,
      newlyAllocated: !hadCode,
    };
  }

  private queueDecisionEmail(args: {
    kind: 'approved' | 'rejected';
    email: string;
    name: string;
    referralCode?: string;
    rejectionReason?: string;
  }) {
    const email = args.email.trim();
    if (!email) return;
    const name = args.name.trim() || email;
    if (args.kind === 'approved' && args.referralCode) {
      void this._partnerOnboardingEmail
        .notifyPartnerApplicationApproved({
          email,
          name,
          referralCode: args.referralCode,
        })
        .catch((e) =>
          this._logger.warn(
            `partner application approved email: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
      return;
    }
    if (args.kind === 'rejected') {
      void this._partnerOnboardingEmail
        .notifyPartnerApplicationRejected({
          email,
          name,
          rejectionReason: args.rejectionReason ?? '',
        })
        .catch((e) =>
          this._logger.warn(
            `partner application rejected email: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    }
  }

  async approveApplicationAdmin(user: UserModel, applicationId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('partner_application_not_found');
    }
    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('partner_application_not_found');
    }
    if (app.status === PartnerApplicationStatus.SUSPENDED) {
      return this.reactivateApplicationAdmin(user, applicationId);
    }
    if (app.status !== PartnerApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('partner_application_not_pending');
    }

    const agentUser = await this._users.findById(app.user).exec();
    if (!agentUser) {
      throw new NotFoundException('user_not_found');
    }

    // Mémoriser le type d’origine pour une éventuelle suspension.
    app.previousUserType = String(agentUser.type ?? UserTypeEnum.USER);
    app.status = PartnerApplicationStatus.APPROVED;
    app.rejectionReason = undefined;
    // Code referral 6 chars — affiché dans l’e-mail d’approbation.
    const referralCode = await this.allocateReferralCodeIfNeeded(app);
    await app.save();

    await this._users
      .updateOne(
        { _id: app.user },
        { $set: { type: UserTypeEnum.PARTNER } },
      )
      .exec();

    // Abonnement FREE par défaut dès le passage en PARTNER.
    await this._partnerSubscriptions
      .ensurePartnerDefaultFreePlan(String(app.user))
      .catch((e) =>
        this._logger.warn(
          `partner default FREE after approve: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

    this._logger.log(
      `partner_application_approved id=${applicationId} user=${String(app.user)} referral=${referralCode}`,
    );

    this.queueDecisionEmail({
      kind: 'approved',
      email: String(agentUser.email ?? ''),
      name:
        String(agentUser.fullName ?? '').trim() ||
        String(app.organizationName ?? '').trim() ||
        String(agentUser.email ?? ''),
      referralCode,
    });

    return this._reloadAdminApplicationRow(applicationId);
  }

  async rejectApplicationAdmin(
    user: UserModel,
    applicationId: string,
    rejectionReason: string,
  ) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('partner_application_not_found');
    }
    const reason = rejectionReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('partner_application_rejection_reason_required');
    }
    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('partner_application_not_found');
    }
    if (app.status !== PartnerApplicationStatus.AWAITING_REVIEW) {
      throw new BadRequestException('partner_application_not_pending');
    }
    app.status = PartnerApplicationStatus.REJECTED;
    app.rejectionReason = reason;
    await app.save();

    const agentUser = await this._users
      .findById(app.user)
      .select('fullName email')
      .lean()
      .exec();
    this.queueDecisionEmail({
      kind: 'rejected',
      email: String(agentUser?.email ?? ''),
      name:
        String(agentUser?.fullName ?? '').trim() ||
        String(app.organizationName ?? '').trim() ||
        String(agentUser?.email ?? ''),
      rejectionReason: reason,
    });

    return this._reloadAdminApplicationRow(applicationId);
  }

  async suspendApplicationAdmin(
    user: UserModel,
    applicationId: string,
    suspensionReason?: string,
  ) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('partner_application_not_found');
    }
    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('partner_application_not_found');
    }
    if (app.status !== PartnerApplicationStatus.APPROVED) {
      throw new BadRequestException('partner_application_not_approved');
    }
    const reason = (suspensionReason ?? '').trim();
    app.status = PartnerApplicationStatus.SUSPENDED;
    app.rejectionReason =
      reason.length >= 3 ? reason : app.rejectionReason ?? undefined;
    await app.save();

    const restoreType = resolvePartnerSuspendRestoreType(app.previousUserType);
    await this._users
      .updateOne({ _id: app.user }, { $set: { type: restoreType } })
      .exec();

    return this._reloadAdminApplicationRow(applicationId);
  }

  async reactivateApplicationAdmin(user: UserModel, applicationId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new NotFoundException('partner_application_not_found');
    }
    const app = await this._applications.findById(applicationId).exec();
    if (!app) {
      throw new NotFoundException('partner_application_not_found');
    }
    if (app.status !== PartnerApplicationStatus.SUSPENDED) {
      throw new BadRequestException('partner_application_not_suspended');
    }

    app.status = PartnerApplicationStatus.APPROVED;
    app.rejectionReason = undefined;
    // Garantir un code si une ancienne approbation n’en avait pas.
    await this.allocateReferralCodeIfNeeded(app);
    await app.save();

    await this._users
      .updateOne(
        { _id: app.user },
        { $set: { type: UserTypeEnum.PARTNER } },
      )
      .exec();

    // Réactivation : rétablir FREE s’il n’y a plus d’abonnement actif.
    await this._partnerSubscriptions
      .ensurePartnerDefaultFreePlan(String(app.user))
      .catch((e) =>
        this._logger.warn(
          `partner default FREE after reactivate: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );

    return this._reloadAdminApplicationRow(applicationId);
  }

  private async _reloadAdminApplicationRow(applicationId: string) {
    const lean = await this._applications
      .findById(applicationId)
      .lean<LeanApp>()
      .exec();
    if (!lean) {
      throw new NotFoundException('partner_application_not_found');
    }
    const u = await this._users
      .findById(lean.user)
      .select('fullName email phoneNumber profileImage type')
      .lean()
      .exec();
    return this.mapAdminRow(
      lean,
      u as {
        fullName?: string;
        email?: string;
        phoneNumber?: string;
        type?: string;
      },
    );
  }
}
