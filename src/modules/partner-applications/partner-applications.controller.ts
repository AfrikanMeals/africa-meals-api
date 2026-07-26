import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
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
  PatchPartnerApplicationDto,
  RejectPartnerApplicationDto,
  SuspendPartnerApplicationDto,
} from './dto/partner-application.dto';
import { PartnerApplicationsService } from './partner-applications.service';

@ApiTags('partner-applications')
@ApiBearerAuth('bearer')
@Controller('partner')
export class PartnerApplicationsController {
  @Inject(PartnerApplicationsService)
  private readonly _partnerApps: PartnerApplicationsService;

  @Get('application')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Fiche candidature partenaire plateforme (création brouillon implicite si éligible).',
  })
  async getApplication(@Req() req: Request) {
    return this._partnerApps.getOrCreateMine(req.user as UserModel);
  }

  @Patch('application')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({ summary: 'Met à jour le brouillon de candidature partenaire.' })
  async patchApplication(
    @Req() req: Request,
    @Body() dto: PatchPartnerApplicationDto,
  ) {
    return this._partnerApps.patchMine(req.user as UserModel, dto);
  }

  @Post('application/submit')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Soumet la candidature partenaire pour validation admin.' })
  async submit(@Req() req: Request) {
    return this._partnerApps.submitMine(req.user as UserModel);
  }

  @Get('admin/applications')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Admin — liste des candidatures partenaires.' })
  async listApplicationsAdmin(
    @Req() req: Request,
    @Query('status') status?: string,
  ) {
    return this._partnerApps.listApplicationsAdmin(
      req.user as UserModel,
      status,
    );
  }

  @Post('admin/applications/:applicationId/approve')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Admin — approuver une candidature (passe le compte en PARTNER).',
  })
  async approveApplicationAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
  ) {
    return this._partnerApps.approveApplicationAdmin(
      req.user as UserModel,
      applicationId,
    );
  }

  @Post('admin/applications/:applicationId/reject')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({ summary: 'Admin — refuser une candidature partenaire.' })
  async rejectApplicationAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() body: RejectPartnerApplicationDto,
  ) {
    return this._partnerApps.rejectApplicationAdmin(
      req.user as UserModel,
      applicationId,
      body.rejectionReason,
    );
  }

  @Post('admin/applications/:applicationId/suspend')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary:
      'Admin — suspendre un partenaire approuvé (restaure le type utilisateur précédent).',
  })
  async suspendApplicationAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() body: SuspendPartnerApplicationDto,
  ) {
    return this._partnerApps.suspendApplicationAdmin(
      req.user as UserModel,
      applicationId,
      body.suspensionReason,
    );
  }

  @Post('admin/applications/:applicationId/reactivate')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Admin — réactiver un partenaire suspendu (type PARTNER).',
  })
  async reactivateApplicationAdmin(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
  ) {
    return this._partnerApps.reactivateApplicationAdmin(
      req.user as UserModel,
      applicationId,
    );
  }
}
