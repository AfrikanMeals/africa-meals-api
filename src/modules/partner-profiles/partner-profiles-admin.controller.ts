import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { AssignStripeConnectDto } from '@modules/store/dto/assign-stripe-connect.dto';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  EnsurePartnerReferralCodeDto,
  RejectPartnerProfileDto,
  SuspendPartnerProfileDto,
} from './dto/partner-profile.dto';
import { PartnerProfilesService } from './partner-profiles.service';

/**
 * Liste + revue admin des fiches métier (partner_profiles).
 * Distinct de Collaborations (partner_applications).
 */
@ApiTags('partner-profiles-admin')
@ApiBearerAuth('bearer')
@Controller('partner/admin')
export class PartnerProfilesAdminController {
  @Inject(PartnerProfilesService)
  private readonly _partnerProfiles: PartnerProfilesService;

  @Get('profiles')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — liste des fiches partenaires (soumises / approuvées / …).',
  })
  async listProfilesAdmin(
    @Req() req: Request,
    @Query('status') status?: string,
  ) {
    return this._partnerProfiles.listProfilesAdmin(
      req.user as UserModel,
      status,
    );
  }

  @Post('profiles/:profileId/approve')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Admin — approuver une fiche soumise (reste type PARTNER).',
  })
  async approveProfileAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
  ) {
    return this._partnerProfiles.approveProfileAdmin(
      req.user as UserModel,
      profileId,
    );
  }

  @Post('profiles/:profileId/reject')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({ summary: 'Admin — refuser une fiche (motif requis).' })
  async rejectProfileAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
    @Body() body: RejectPartnerProfileDto,
  ) {
    return this._partnerProfiles.rejectProfileAdmin(
      req.user as UserModel,
      profileId,
      body.rejectionReason,
    );
  }

  @Post('profiles/:profileId/suspend')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Admin — suspendre une fiche approuvée (restaure le type utilisateur).',
  })
  async suspendProfileAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
    @Body() body: SuspendPartnerProfileDto,
  ) {
    return this._partnerProfiles.suspendProfileAdmin(
      req.user as UserModel,
      profileId,
      body.suspensionReason,
    );
  }

  @Post('profiles/:profileId/reactivate')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Admin — réactiver une fiche suspendue (type PARTNER).',
  })
  async reactivateProfileAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
  ) {
    return this._partnerProfiles.reactivateProfileAdmin(
      req.user as UserModel,
      profileId,
    );
  }

  @Post('profiles/:profileId/revert-to-submitted')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — remettre une fiche APPROVED en SUBMITTED (approbation par erreur).',
  })
  async revertProfileToSubmittedAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
  ) {
    return this._partnerProfiles.revertProfileToSubmittedAdmin(
      req.user as UserModel,
      profileId,
    );
  }

  @Post('profiles/:profileId/ensure-referral-code')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Admin — générer, renvoyer ou définir (unique) le code de parrainage Partner.',
  })
  async ensureReferralCodeAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
    @Body() body: EnsurePartnerReferralCodeDto,
  ) {
    return this._partnerProfiles.ensureReferralCodeAdmin(
      req.user as UserModel,
      profileId,
      body?.referralCode,
    );
  }

  @Post('profiles/:profileId/assign-stripe-connect')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary:
      'Admin — lie manuellement un compte Stripe Connect (acct_…) à un Partner approuvé.',
  })
  async assignStripeConnectAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
    @Body() body: AssignStripeConnectDto,
  ) {
    return this._partnerProfiles.assignStripeConnectForAdmin(
      req.user as UserModel,
      profileId,
      body.stripeAccountId,
    );
  }

  @Post('profiles/:profileId/sync-stripe-connect')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — resynchronise le statut Stripe Connect d’un Partner approuvé.',
  })
  async syncStripeConnectAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
  ) {
    return this._partnerProfiles.syncStripeConnectForAdmin(
      req.user as UserModel,
      profileId,
    );
  }

  @Post('profiles/:profileId/reset-stripe-connect')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — déconnecte Stripe Connect d’un Partner approuvé (nouvel onboarding).',
  })
  async resetStripeConnectAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
  ) {
    return this._partnerProfiles.resetStripeConnectForAdmin(
      req.user as UserModel,
      profileId,
    );
  }

  @Get('profiles/:profileId/finance-overview')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — Connect + commissions d’un Partner (Collaborations → Finances).',
  })
  async financeOverviewAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
  ) {
    return this._partnerProfiles.getFinanceOverviewForAdmin(
      req.user as UserModel,
      profileId,
    );
  }

  @Get('profiles/:profileId/referrers')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Admin — réseau référents d’un Partner (Collaborations → Référents).',
  })
  async referrersAdmin(
    @Req() req: Request,
    @Param('profileId') profileId: string,
  ) {
    return this._partnerProfiles.getReferrersForAdmin(
      req.user as UserModel,
      profileId,
    );
  }
}
