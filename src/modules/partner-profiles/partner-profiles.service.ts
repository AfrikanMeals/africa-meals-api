import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PartnerAccountType,
  PartnerProfileModel,
  PartnerProfileStatus,
} from '@schemas/partner-profile.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { StripeConnectService } from '@modules/billing/stripe/stripe-connect.service';
import { resolveStripeOnboardingStatusLabel } from '@modules/billing/stripe/stripe-connect-visibility';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PartnerApplicationsService } from '@modules/partner-applications/partner-applications.service';
import { PartnerAffiliationEarningsService } from '@modules/partner-subscriptions/partner-affiliation-earnings.service';
import { normalizePartnerDisplayCurrency } from '@modules/partner-subscriptions/partner-earning-list.util';
import { PartnerSubscriptionPlansService } from '@modules/partner-subscriptions/partner-subscription-plans.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { PartnerOnboardingEmailService } from '@modules/vendor-emails/partner-onboarding-email.service';
import { resolvePartnerSuspendRestoreType } from '@modules/partner-applications/partner-application-eligibility.util';
import { PatchPartnerProfileDto } from './dto/partner-profile.dto';
import { buildPartnerApplicationNotesFromProfile } from './partner-application-from-profile.util';
import { canAccessPartnerProfileSelf } from './partner-profile-self-access.util';
import {
  canApprovePartnerProfile,
  canManagePartnerProfileStripe,
  canReactivatePartnerProfile,
  canRejectPartnerProfile,
  canRevertPartnerProfileToSubmitted,
  canSuspendPartnerProfile,
  canViewPartnerProfileFinance,
  normalizePartnerProfileAdminStatusFilter,
} from './partner-profile-admin-status.util';
import type { PartnerProfileReviewNotifyStatus } from './partner-profile-review-notification.util';
import {
  isOptionalHttpUrl,
  isPartnerProfileReadyToSubmit,
  normalizePartnerAccountType,
  resolvePartnerDisplayName,
} from './partner-profile-validation.util';

/** Champs user joints pour Stripe + identité liste admin. */
const ADMIN_USER_SELECT =
  'fullName email phoneNumber type stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue appCountryCode';

type AdminAccountLean = {
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  type?: string;
  stripeConnectAccountId?: string;
  stripeConnectChargesEnabled?: boolean;
  stripeConnectPayoutsEnabled?: boolean;
  stripeConnectDetailsSubmitted?: boolean;
  stripeConnectDisabledReason?: string;
  stripeConnectRequirementsDue?: string[];
  stripeConnectRequirementsPastDue?: string[];
  appCountryCode?: string;
};

type LeanProfile = {
  _id?: Types.ObjectId;
  user?: Types.ObjectId;
  status: PartnerProfileStatus;
  onboardingStep: number;
  accountType?: PartnerAccountType;
  individualName?: string;
  companyName?: string;
  taxNumber?: string;
  address?: string;
  addressLatitude?: number;
  addressLongitude?: number;
  facebookUrl?: string;
  tiktokUrl?: string;
  instagramUrl?: string;
  policyAccepted: boolean;
  submittedAt?: Date;
  rejectionReason?: string;
  previousUserType?: string;
  reviewedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

const PROFILE_PUBLIC_SELECT =
  'status onboardingStep accountType individualName companyName taxNumber address addressLatitude addressLongitude facebookUrl tiktokUrl instagramUrl policyAccepted submittedAt rejectionReason updatedAt createdAt user';

@Injectable()
export class PartnerProfilesService {
  private readonly _logger = new Logger(PartnerProfilesService.name);

  constructor(
    @InjectModel(PartnerProfileModel.name)
    private readonly _profiles: Model<PartnerProfileModel>,
    @InjectModel(UserModel.name)
    private readonly _users: Model<UserModel>,
    private readonly _partnerOnboardingEmail: PartnerOnboardingEmailService,
    private readonly _notifications: NotificationsService,
    // Codes referral stockés sur partner_applications (pas sur la fiche).
    private readonly _partnerApplications: PartnerApplicationsService,
    // Admin Collaborations : lier / sync / reset Connect + aperçu finance.
    private readonly _stripeConnect: StripeConnectService,
    private readonly _affiliation: PartnerAffiliationEarningsService,
    private readonly _plans: PartnerSubscriptionPlansService,
    private readonly _supportedCountries: SupportedCountriesService,
  ) {}

  /**
   * Self-service fiche : PARTNER ou candidat éligible (USER/VENDOR/DELIVERY).
   * Remplace le formulaire « Devenir partenaire ».
   */
  private assertPartnerProfileAccess(user: UserModel) {
    if (!canAccessPartnerProfileSelf(user.type)) {
      throw new ForbiddenException('partner_profile_partner_only');
    }
  }

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  private assertOptionalUrls(dto: PatchPartnerProfileDto) {
    if (dto.facebookUrl !== undefined && !isOptionalHttpUrl(dto.facebookUrl)) {
      throw new BadRequestException('partner_profile_facebook_url_invalid');
    }
    if (dto.tiktokUrl !== undefined && !isOptionalHttpUrl(dto.tiktokUrl)) {
      throw new BadRequestException('partner_profile_tiktok_url_invalid');
    }
    if (
      dto.instagramUrl !== undefined &&
      !isOptionalHttpUrl(dto.instagramUrl)
    ) {
      throw new BadRequestException('partner_profile_instagram_url_invalid');
    }
  }

  toPublic(doc: LeanProfile | null) {
    if (!doc) {
      return {
        status: PartnerProfileStatus.DRAFT,
        onboardingStep: 0,
        accountType: null as string | null,
        individualName: null as string | null,
        companyName: null as string | null,
        taxNumber: null as string | null,
        address: null as string | null,
        addressLatitude: null as number | null,
        addressLongitude: null as number | null,
        facebookUrl: null as string | null,
        tiktokUrl: null as string | null,
        instagramUrl: null as string | null,
        policyAccepted: false,
        submittedAt: null as string | null,
        rejectionReason: null as string | null,
        updatedAt: null as string | null,
      };
    }
    return {
      status: doc.status,
      onboardingStep: doc.onboardingStep ?? 0,
      accountType: doc.accountType ?? null,
      individualName: doc.individualName?.trim() || null,
      companyName: doc.companyName?.trim() || null,
      taxNumber: doc.taxNumber?.trim() || null,
      address: doc.address?.trim() || null,
      addressLatitude:
        typeof doc.addressLatitude === 'number' ? doc.addressLatitude : null,
      addressLongitude:
        typeof doc.addressLongitude === 'number' ? doc.addressLongitude : null,
      facebookUrl: doc.facebookUrl?.trim() || null,
      tiktokUrl: doc.tiktokUrl?.trim() || null,
      instagramUrl: doc.instagramUrl?.trim() || null,
      policyAccepted: Boolean(doc.policyAccepted),
      submittedAt: doc.submittedAt
        ? new Date(doc.submittedAt).toISOString()
        : null,
      rejectionReason: doc.rejectionReason?.trim() || null,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    };
  }

  async getOrCreateMine(user: UserModel) {
    this.assertPartnerProfileAccess(user);
    const uid = user._id as Types.ObjectId;
    let doc = await this._profiles
      .findOne({ user: uid })
      .select(PROFILE_PUBLIC_SELECT)
      .lean<LeanProfile>()
      .exec();
    if (!doc) {
      await this._profiles.create({
        user: uid,
        status: PartnerProfileStatus.DRAFT,
        onboardingStep: 0,
        policyAccepted: false,
      });
      doc = await this._profiles
        .findOne({ user: uid })
        .select(PROFILE_PUBLIC_SELECT)
        .lean<LeanProfile>()
        .exec();
    }
    return this.toPublic(doc);
  }

  async patchMine(user: UserModel, dto: PatchPartnerProfileDto) {
    this.assertPartnerProfileAccess(user);
    this.assertOptionalUrls(dto);
    const uid = user._id as Types.ObjectId;
    await this.getOrCreateMine(user);

    const $set: Record<string, unknown> = {};
    if (dto.onboardingStep !== undefined) {
      $set.onboardingStep = dto.onboardingStep;
    }
    if (dto.accountType !== undefined) {
      const t = normalizePartnerAccountType(dto.accountType);
      if (!t) {
        throw new BadRequestException('partner_profile_account_type_invalid');
      }
      $set.accountType = t;
    }
    if (dto.individualName !== undefined) {
      $set.individualName = dto.individualName.trim();
    }
    if (dto.companyName !== undefined) {
      $set.companyName = dto.companyName.trim();
    }
    if (dto.taxNumber !== undefined) {
      $set.taxNumber = dto.taxNumber.trim();
    }
    if (dto.address !== undefined) {
      $set.address = dto.address.trim();
    }
    if (dto.addressLatitude !== undefined) {
      $set.addressLatitude = dto.addressLatitude;
    }
    if (dto.addressLongitude !== undefined) {
      $set.addressLongitude = dto.addressLongitude;
    }
    if (dto.facebookUrl !== undefined) {
      $set.facebookUrl = dto.facebookUrl.trim();
    }
    if (dto.tiktokUrl !== undefined) {
      $set.tiktokUrl = dto.tiktokUrl.trim();
    }
    if (dto.instagramUrl !== undefined) {
      $set.instagramUrl = dto.instagramUrl.trim();
    }
    if (dto.policyAccepted !== undefined) {
      $set.policyAccepted = dto.policyAccepted;
    }

    if (Object.keys($set).length === 0) {
      return this.getOrCreateMine(user);
    }

    await this._profiles
      .updateOne({ user: uid }, { $set })
      .exec();
    return this.getOrCreateMine(user);
  }

  async submitMine(user: UserModel) {
    this.assertPartnerProfileAccess(user);
    const current = await this.getOrCreateMine(user);
    if (
      !isPartnerProfileReadyToSubmit({
        accountType: current.accountType,
        individualName: current.individualName,
        companyName: current.companyName,
        address: current.address,
        addressLatitude: current.addressLatitude,
        addressLongitude: current.addressLongitude,
        facebookUrl: current.facebookUrl,
        tiktokUrl: current.tiktokUrl,
        instagramUrl: current.instagramUrl,
        policyAccepted: current.policyAccepted,
      })
    ) {
      throw new BadRequestException('partner_profile_incomplete');
    }
    // Mail confirmation seulement à la 1ʳᵉ soumission (pas re-submit après refus).
    const firstSubmit = !current.submittedAt;
    const uid = user._id as Types.ObjectId;
    await this._profiles
      .updateOne(
        { user: uid },
        {
          $set: {
            status: PartnerProfileStatus.SUBMITTED,
            submittedAt: new Date(),
            onboardingStep: 2,
            policyAccepted: true,
          },
          $unset: { rejectionReason: 1 },
        },
      )
      .exec();
    this._logger.log(`Partner profile submitted user=${String(uid)}`);

    // Candidat (pas encore PARTNER) : pousser Collaborations AWAITING_REVIEW
    // à partir de la fiche (remplace l’ancien formulaire Become Partner).
    if (user.type !== UserTypeEnum.PARTNER) {
      const displayName =
        resolvePartnerDisplayName({
          accountType: current.accountType,
          individualName: current.individualName,
          companyName: current.companyName,
        }) ||
        String(user.fullName ?? '').trim() ||
        String(user.email ?? '').trim();
      const notes = buildPartnerApplicationNotesFromProfile({
        displayName,
        address: String(current.address ?? ''),
      });
      void this._partnerApplications
        .enqueueCollaborationsReviewFromProfile(user, {
          organizationName: displayName,
          collaborationNotes: notes,
          regionCode: String(
            (user as { appCountryCode?: string }).appCountryCode ?? '',
          ),
        })
        .catch((e) =>
          this._logger.warn(
            `partner application sync from profile: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    }

    if (firstSubmit) {
      const displayName =
        resolvePartnerDisplayName({
          accountType: current.accountType,
          individualName: current.individualName,
          companyName: current.companyName,
        }) ||
        String(user.fullName ?? '').trim() ||
        String(user.email ?? '').trim();
      void this._partnerOnboardingEmail
        .notifyPartnerProfileSubmitted({
          email: String(user.email ?? '').trim(),
          name: displayName,
        })
        .catch((e) =>
          this._logger.warn(
            `partner profile submitted email: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    }
    return this.getOrCreateMine(user);
  }

  /**
   * Admin — liste des fiches métier (≠ Collaborations / partner_applications).
   * Filtre : DRAFT | SUBMITTED | APPROVED | REJECTED | SUSPENDED | ALL.
   */
  async listProfilesAdmin(user: UserModel, statusFilter?: string) {
    this.assertAdmin(user);
    const status = normalizePartnerProfileAdminStatusFilter(statusFilter);
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    // Pas de `.select()` restrictif : le schéma mappe certains champs en snake_case
    // (`company_name`) alors que des docs legacy sont en camelCase (`companyName`) —
    // une projection mongoose vidait alors raison sociale / adresse sur la liste admin.
    const rows = await this._profiles
      .find(filter)
      .sort({ submittedAt: -1, updatedAt: -1, createdAt: -1 })
      .lean<LeanProfile[]>()
      .exec();

    const userIds = [
      ...new Set(
        rows
          .map((r) => String(r.user ?? ''))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const users = await this._users
      .find({ _id: { $in: userIds } })
      .select(ADMIN_USER_SELECT)
      .lean()
      .exec();
    const userById = new Map(
      users.map((u) => [String(u._id), u as AdminAccountLean]),
    );

    // Jointure codes referral (collection candidatures) pour le bouton Collaborations.
    const referralByUser =
      await this._partnerApplications.mapReferralCodesByUserIds(userIds);

    return rows.map((r) =>
      this.mapAdminRow(
        r,
        userById.get(String(r.user)),
        referralByUser.get(String(r.user)) ?? null,
      ),
    );
  }

  /** Admin — lie manuellement un compte Stripe Connect (acct_…) à un Partner approuvé. */
  async assignStripeConnectForAdmin(
    admin: UserModel,
    profileId: string,
    stripeAccountId: string,
  ) {
    this.assertAdmin(admin);
    const profile = await this.requireApprovedProfile(profileId);
    await this._stripeConnect.assignConnectAccountForUserAdmin({
      userId: new Types.ObjectId(String(profile.user)),
      stripeAccountId,
    });
    return this.reloadAdminProfileRow(profileId);
  }

  /** Admin — resynchronise le statut Stripe Connect depuis Stripe. */
  async syncStripeConnectForAdmin(admin: UserModel, profileId: string) {
    this.assertAdmin(admin);
    const profile = await this.requireApprovedProfile(profileId);
    await this._stripeConnect.syncConnectAccountForUserAdmin({
      userId: new Types.ObjectId(String(profile.user)),
    });
    return this.reloadAdminProfileRow(profileId);
  }

  /** Admin — déconnecte Stripe Connect (nouvel onboarding Partner requis). */
  async resetStripeConnectForAdmin(admin: UserModel, profileId: string) {
    this.assertAdmin(admin);
    const profile = await this.requireApprovedProfile(profileId);
    await this._stripeConnect.resetConnectForReonboarding({
      userId: new Types.ObjectId(String(profile.user)),
    });
    return this.reloadAdminProfileRow(profileId);
  }

  /**
   * Admin — aperçu Finances (Connect + commissions) pour une fiche Collaborations.
   * Connect live seulement si le compte est encore type PARTNER.
   */
  async getFinanceOverviewForAdmin(admin: UserModel, profileId: string) {
    this.assertAdmin(admin);
    const profile = await this.loadProfileOrThrow(profileId);
    if (!canViewPartnerProfileFinance(profile.status)) {
      throw new BadRequestException('partner_profile_finance_view_denied');
    }
    const uid = String(profile.user ?? '');
    const account = await this._users.findById(uid).exec();
    if (!account) {
      throw new NotFoundException('partner_profile_user_not_found');
    }

    const earnings =
      await this._affiliation.listEarningsByPartnerUserId(uid);
    const pricingRegion =
      await this._plans.resolvePricingRegionForUser(account);
    const displayCurrency = pricingRegion
      ? await this._supportedCountries.getCountryCurrency(pricingRegion)
      : 'CAD';

    // Connect Stripe : lecture live seulement pour type PARTNER (assert recipient).
    let connect: Awaited<
      ReturnType<StripeConnectService['getConnectStatus']>
    > | null = null;
    let balance: Awaited<
      ReturnType<StripeConnectService['getConnectBalance']>
    > | null = null;
    let payouts: Awaited<
      ReturnType<StripeConnectService['listPayouts']>
    > | null = null;
    if (account.type === UserTypeEnum.PARTNER) {
      try {
        connect = await this._stripeConnect.getConnectStatus(account);
        balance = await this._stripeConnect.getConnectBalance(account);
        payouts = await this._stripeConnect.listPayouts(account, 10);
      } catch (e) {
        this._logger.warn(
          `partner finance overview connect: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    return {
      profileId: String(profile._id ?? profileId),
      userId: uid,
      displayName:
        resolvePartnerDisplayName({
          accountType: profile.accountType,
          individualName: profile.individualName,
          companyName: profile.companyName,
        }) ||
        String(account.fullName ?? '').trim() ||
        String(account.email ?? '').trim() ||
        '—',
      status: profile.status,
      displayCurrency: normalizePartnerDisplayCurrency(displayCurrency),
      pricingRegion: pricingRegion
        ? String(pricingRegion).trim().toUpperCase()
        : null,
      connect,
      balance,
      payouts: payouts?.payouts ?? [],
      earnings,
    };
  }

  /** Admin — réseau référents d’un Partner (fiche approuvée / suspendue). */
  async getReferrersForAdmin(admin: UserModel, profileId: string) {
    this.assertAdmin(admin);
    const profile = await this.loadProfileOrThrow(profileId);
    if (!canViewPartnerProfileFinance(profile.status)) {
      throw new BadRequestException('partner_profile_referrers_view_denied');
    }
    const uid = String(profile.user ?? '');
    const bundle =
      await this._affiliation.listReferrersByPartnerUserId(uid);
    return {
      profileId: String(profile._id ?? profileId),
      userId: uid,
      ...bundle,
    };
  }

  private async requireApprovedProfile(profileId: string) {
    const profile = await this.loadProfileOrThrow(profileId);
    if (!canManagePartnerProfileStripe(profile.status)) {
      throw new BadRequestException('partner_profile_not_approved');
    }
    return profile;
  }

  /**
   * Admin — génère, renvoie ou définit le code parrainage (fiche APPROVED).
   * `desiredCode` optionnel : code custom (unicité vérifiée) ; sinon auto si absent.
   * Si la valeur change → e-mail + inbox + push Partner (fire-and-forget).
   */
  async ensureReferralCodeAdmin(
    admin: UserModel,
    profileId: string,
    desiredCode?: string | null,
  ) {
    this.assertAdmin(admin);
    const profile = await this.loadProfileOrThrow(profileId);
    if (profile.status !== PartnerProfileStatus.APPROVED) {
      throw new BadRequestException(
        'partner_profile_referral_requires_approved',
      );
    }
    const { referralCode, previousReferralCode, newlyAllocated } =
      await this._partnerApplications.ensureReferralCodeForUserAdmin(
        admin,
        String(profile.user),
        desiredCode,
      );
    // Notifier uniquement si le code stocké a réellement changé (pas l’idempotent).
    if (newlyAllocated) {
      this.queuePartnerReferralCodeChangedNotification({
        recipientUserId: String(profile.user),
        referralCode,
        previousReferralCode,
      });
    }
    const row = await this.reloadAdminProfileRow(profileId);
    return { ...row, referralCode, newlyAllocated };
  }

  /** Admin — fiche soumise → approuvée (compte déjà PARTNER). */
  async approveProfileAdmin(admin: UserModel, profileId: string) {
    this.assertAdmin(admin);
    const profile = await this.loadProfileOrThrow(profileId);
    if (profile.status === PartnerProfileStatus.SUSPENDED) {
      return this.reactivateProfileAdmin(admin, profileId);
    }
    if (!canApprovePartnerProfile(profile.status)) {
      throw new BadRequestException('partner_profile_not_pending');
    }
    profile.status = PartnerProfileStatus.APPROVED;
    profile.rejectionReason = undefined;
    profile.reviewedAt = new Date();
    await profile.save();

    // 1. Allouer le code AVANT e-mail / inbox / push (sinon corps sans referral).
    let referralCode = '';
    try {
      const ensured =
        await this._partnerApplications.ensureReferralCodeForUserAdmin(
          admin,
          String(profile.user),
        );
      referralCode = ensured.referralCode;
    } catch (e) {
      this._logger.warn(
        `partner referral before profile approve notify: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    const agentUser = await this._users
      .findById(profile.user)
      .select('fullName email')
      .lean()
      .exec();
    // 2. E-mail fire-and-forget — SMTP down ne bloque pas l’HTTP admin.
    if (referralCode) {
      void this._partnerOnboardingEmail
        .notifyPartnerProfileApproved({
          email: String(agentUser?.email ?? ''),
          name:
            String(agentUser?.fullName ?? '').trim() ||
            String(agentUser?.email ?? ''),
          referralCode,
        })
        .catch((e) =>
          this._logger.warn(
            `partner profile approved email: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    } else {
      this._logger.warn(
        `partner_profile_approved_email_skipped_no_referral id=${profileId}`,
      );
    }
    // 3. Inbox + FCM (onglet Notification mobile Partner) avec code si dispo.
    this.queuePartnerProfileReviewNotification({
      recipientUserId: String(profile.user),
      profileId,
      status: 'APPROVED',
      referralCode: referralCode || undefined,
    });

    this._logger.log(
      `partner_profile_approved id=${profileId} referral=${referralCode || 'none'}`,
    );
    return this.reloadAdminProfileRow(profileId);
  }

  /** Admin — refus fiche (le partenaire peut corriger et re-soumettre). */
  async rejectProfileAdmin(
    admin: UserModel,
    profileId: string,
    rejectionReason: string,
  ) {
    this.assertAdmin(admin);
    const reason = rejectionReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('partner_profile_rejection_reason_required');
    }
    const profile = await this.loadProfileOrThrow(profileId);
    if (!canRejectPartnerProfile(profile.status)) {
      throw new BadRequestException('partner_profile_not_pending');
    }
    profile.status = PartnerProfileStatus.REJECTED;
    profile.rejectionReason = reason;
    profile.reviewedAt = new Date();
    await profile.save();

    const agentUser = await this._users
      .findById(profile.user)
      .select('fullName email')
      .lean()
      .exec();
    // Template fiche (pas candidature Collaborations) — motif admin inclus.
    void this._partnerOnboardingEmail
      .notifyPartnerProfileRejected({
        email: String(agentUser?.email ?? ''),
        name:
          String(agentUser?.fullName ?? '').trim() ||
          String(agentUser?.email ?? ''),
        rejectionReason: reason,
      })
      .catch((e) =>
        this._logger.warn(
          `partner profile rejected email: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
    this.queuePartnerProfileReviewNotification({
      recipientUserId: String(profile.user),
      profileId,
      status: 'REJECTED',
      rejectionReason: reason,
    });

    this._logger.log(`partner_profile_rejected id=${profileId}`);
    return this.reloadAdminProfileRow(profileId);
  }

  /**
   * Admin — suspend fiche approuvée + retire le type PARTNER
   * (restaure previousUserType ou USER).
   */
  async suspendProfileAdmin(
    admin: UserModel,
    profileId: string,
    suspensionReason?: string,
  ) {
    this.assertAdmin(admin);
    const profile = await this.loadProfileOrThrow(profileId);
    if (!canSuspendPartnerProfile(profile.status)) {
      throw new BadRequestException('partner_profile_not_approved');
    }
    const agentUser = await this._users.findById(profile.user).exec();
    if (!agentUser) {
      throw new NotFoundException('user_not_found');
    }
    // Mémoriser le type courant si pas déjà stocké (signup PARTNER → USER au restore).
    if (!profile.previousUserType) {
      const cur = String(agentUser.type ?? UserTypeEnum.USER);
      profile.previousUserType =
        cur === UserTypeEnum.PARTNER ? UserTypeEnum.USER : cur;
    }
    const reason = (suspensionReason ?? '').trim();
    profile.status = PartnerProfileStatus.SUSPENDED;
    profile.rejectionReason =
      reason.length >= 3 ? reason : profile.rejectionReason ?? undefined;
    profile.reviewedAt = new Date();
    await profile.save();

    const restoreType = resolvePartnerSuspendRestoreType(
      profile.previousUserType,
    );
    await this._users
      .updateOne({ _id: profile.user }, { $set: { type: restoreType } })
      .exec();

    this.queuePartnerProfileReviewNotification({
      recipientUserId: String(profile.user),
      profileId,
      status: 'SUSPENDED',
      rejectionReason: profile.rejectionReason,
    });

    this._logger.log(
      `partner_profile_suspended id=${profileId} restore=${restoreType}`,
    );
    return this.reloadAdminProfileRow(profileId);
  }

  /**
   * Admin — annuler une approbation par erreur : APPROVED → SUBMITTED.
   * Ne touche pas au type PARTNER ni au code referral ; pas de notif Partner.
   */
  async revertProfileToSubmittedAdmin(admin: UserModel, profileId: string) {
    this.assertAdmin(admin);
    const profile = await this.loadProfileOrThrow(profileId);
    if (!canRevertPartnerProfileToSubmitted(profile.status)) {
      throw new BadRequestException('partner_profile_not_approved');
    }
    profile.status = PartnerProfileStatus.SUBMITTED;
    profile.rejectionReason = undefined;
    // Remettre en file de revue : pas de reviewedAt tant que non re-décidé.
    profile.reviewedAt = undefined;
    if (!profile.submittedAt) {
      profile.submittedAt = new Date();
    }
    await profile.save();

    this._logger.log(`partner_profile_reverted_to_submitted id=${profileId}`);
    return this.reloadAdminProfileRow(profileId);
  }

  /** Admin — réactive fiche + type PARTNER. */
  async reactivateProfileAdmin(admin: UserModel, profileId: string) {
    this.assertAdmin(admin);
    const profile = await this.loadProfileOrThrow(profileId);
    if (!canReactivatePartnerProfile(profile.status)) {
      throw new BadRequestException('partner_profile_not_suspended');
    }
    profile.status = PartnerProfileStatus.APPROVED;
    profile.rejectionReason = undefined;
    profile.reviewedAt = new Date();
    await profile.save();

    await this._users
      .updateOne(
        { _id: profile.user },
        { $set: { type: UserTypeEnum.PARTNER } },
      )
      .exec();

    this.queuePartnerProfileReviewNotification({
      recipientUserId: String(profile.user),
      profileId,
      status: 'REACTIVATED',
    });

    this._logger.log(`partner_profile_reactivated id=${profileId}`);
    return this.reloadAdminProfileRow(profileId);
  }

  /** Fire-and-forget inbox + FCM (ne bloque pas l’HTTP admin). */
  private queuePartnerProfileReviewNotification(args: {
    recipientUserId: string;
    profileId: string;
    status: PartnerProfileReviewNotifyStatus;
    rejectionReason?: string | null;
    referralCode?: string | null;
  }) {
    void this._notifications
      .notifyPartnerProfileReview({
        recipientUserId: args.recipientUserId,
        profileId: args.profileId,
        status: args.status,
        rejectionReason: args.rejectionReason?.trim() || undefined,
        referralCode: args.referralCode?.trim() || undefined,
      })
      .catch((e) =>
        this._logger.warn(
          `partner profile review notification: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
  }

  /**
   * Fire-and-forget e-mail + inbox + FCM après changement code referral admin.
   * Charge e-mail / nom user ; n’échoue pas l’HTTP Collaborations.
   */
  private queuePartnerReferralCodeChangedNotification(args: {
    recipientUserId: string;
    referralCode: string;
    previousReferralCode?: string | null;
  }) {
    const userId = args.recipientUserId;
    const code = String(args.referralCode ?? '')
      .trim()
      .toUpperCase();
    if (!code || !Types.ObjectId.isValid(userId)) return;

    void (async () => {
      try {
        const user = await this._users
          .findById(userId)
          .select('email fullName')
          .lean<{ email?: string; fullName?: string }>()
          .exec();
        const email = String(user?.email ?? '').trim();
        const name = String(user?.fullName ?? '').trim() || email;
        if (email) {
          await this._partnerOnboardingEmail.notifyPartnerReferralCodeChanged({
            email,
            name,
            referralCode: code,
            previousReferralCode: args.previousReferralCode,
          });
        }
        await this._notifications.notifyPartnerReferralCodeChanged({
          recipientUserId: userId,
          referralCode: code,
          previousReferralCode: args.previousReferralCode,
        });
      } catch (e) {
        this._logger.warn(
          `partner referral code changed notification: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    })();
  }

  private async loadProfileOrThrow(profileId: string) {
    if (!Types.ObjectId.isValid(profileId)) {
      throw new NotFoundException('partner_profile_not_found');
    }
    const profile = await this._profiles.findById(profileId).exec();
    if (!profile) {
      throw new NotFoundException('partner_profile_not_found');
    }
    return profile;
  }

  private async reloadAdminProfileRow(profileId: string) {
    const lean = await this._profiles
      .findById(profileId)
      .lean<LeanProfile>()
      .exec();
    if (!lean) {
      throw new NotFoundException('partner_profile_not_found');
    }
    const account = await this._users
      .findById(lean.user)
      .select(ADMIN_USER_SELECT)
      .lean()
      .exec();
    const uid = String(lean.user ?? '');
    const referralMap =
      await this._partnerApplications.mapReferralCodesByUserIds(
        uid ? [uid] : [],
      );
    return this.mapAdminRow(
      lean,
      (account as AdminAccountLean | null) ?? undefined,
      referralMap.get(uid) ?? null,
    );
  }

  private mapAdminRow(
    doc: LeanProfile,
    account?: AdminAccountLean,
    referralCode: string | null = null,
  ) {
    // Tolère docs camelCase legacy + snake_case schéma (même document lean).
    const raw = doc as LeanProfile & Record<string, unknown>;
    const companyName =
      String(doc.companyName ?? raw.company_name ?? '').trim() || null;
    const individualName =
      String(doc.individualName ?? raw.individual_name ?? '').trim() || null;
    const taxNumber =
      String(doc.taxNumber ?? raw.tax_number ?? '').trim() || null;
    const accountType = (doc.accountType ??
      raw.account_type ??
      null) as PartnerAccountType | null;
    const displayName =
      resolvePartnerDisplayName({
        accountType: accountType ?? undefined,
        individualName: individualName ?? undefined,
        companyName: companyName ?? undefined,
      }) ||
      String(account?.fullName ?? '').trim() ||
      String(account?.email ?? '').trim() ||
      '—';
    // Stripe Connect (user) — miroir candidatures livreurs / vendeurs.
    const stripeOnboardingStatus = resolveStripeOnboardingStatusLabel(account);
    const stripeAccountId = String(
      account?.stripeConnectAccountId ?? '',
    ).trim();
    return {
      id: String(doc._id ?? ''),
      userId: String(doc.user ?? ''),
      userFullName: String(account?.fullName ?? '').trim(),
      userEmail: String(account?.email ?? '').trim(),
      userPhone: String(account?.phoneNumber ?? '').trim(),
      userType: String(account?.type ?? ''),
      displayName,
      status: doc.status,
      onboardingStep: doc.onboardingStep ?? 0,
      accountType,
      individualName,
      companyName,
      taxNumber,
      address: doc.address?.trim() || null,
      addressLatitude:
        typeof doc.addressLatitude === 'number' ? doc.addressLatitude : null,
      addressLongitude:
        typeof doc.addressLongitude === 'number' ? doc.addressLongitude : null,
      facebookUrl: doc.facebookUrl?.trim() || null,
      tiktokUrl: doc.tiktokUrl?.trim() || null,
      instagramUrl: doc.instagramUrl?.trim() || null,
      policyAccepted: Boolean(doc.policyAccepted),
      rejectionReason:
        String(doc.rejectionReason ?? raw.rejection_reason ?? '').trim() ||
        null,
      // Code 6 chars (partner_applications) — null si pas encore généré.
      referralCode,
      stripeOnboardingStatus,
      stripeConnectLinked: stripeAccountId.length > 0,
      stripeConnectActive: stripeOnboardingStatus === 'COMPLETE',
      stripeConnectAccountId:
        stripeAccountId.length > 0 ? stripeAccountId : null,
      submittedAt: doc.submittedAt
        ? new Date(doc.submittedAt).toISOString()
        : null,
      reviewedAt: doc.reviewedAt
        ? new Date(doc.reviewedAt).toISOString()
        : null,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    };
  }
}
