import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { PatchPartnerProfileDto } from './dto/partner-profile.dto';
import { PartnerProfilesService } from './partner-profiles.service';

@ApiTags('partner-profiles')
@ApiBearerAuth('bearer')
@Controller('partner/profile')
export class PartnerProfilesController {
  @Inject(PartnerProfilesService)
  private readonly _partnerProfiles: PartnerProfilesService;

  @Get()
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Fiche partenaire (identité · réseaux · politique) — PARTNER only.',
  })
  async getProfile(@Req() req: Request) {
    return this._partnerProfiles.getOrCreateMine(req.user as UserModel);
  }

  @Patch()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({ summary: 'Met à jour la fiche partenaire (brouillon ou soumis).' })
  async patchProfile(
    @Req() req: Request,
    @Body() dto: PatchPartnerProfileDto,
  ) {
    return this._partnerProfiles.patchMine(req.user as UserModel, dto);
  }

  @Post('submit')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary: 'Soumet la fiche partenaire (identité + acceptation policy).',
  })
  async submit(@Req() req: Request) {
    return this._partnerProfiles.submitMine(req.user as UserModel);
  }
}
