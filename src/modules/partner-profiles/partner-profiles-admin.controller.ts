import { JwtGuard } from '@modules/auth/guards/jwt.guard';
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
}
