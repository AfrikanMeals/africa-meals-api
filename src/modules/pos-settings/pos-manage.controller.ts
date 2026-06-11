import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  CreatePosLicensePlanDto,
  UpdatePosLicensePlanDto,
  UpsertPosVendorLicenseDto,
} from './dto/pos-license.dto';
import { UpdatePosDownloadsDto } from './dto/update-pos-downloads.dto';
import { PosSettingsService } from './pos-settings.service';

@ApiTags('pos')
@ApiBearerAuth('bearer')
@Controller('pos')
export class PosManageController {
  @Inject(PosSettingsService)
  private readonly _pos: PosSettingsService;

  @Get('overview')
  @UseGuards(JwtGuard)
  getOverview(@Req() req: Request) {
    return this._pos.getAdminOverview(req.user as UserModel);
  }

  @Put('downloads')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateDownloads(@Req() req: Request, @Body() body: UpdatePosDownloadsDto) {
    return this._pos.updateDownloads(req.user as UserModel, body);
  }

  @Get('plans')
  @UseGuards(JwtGuard)
  listPlans(
    @Req() req: Request,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const all =
      includeInactive === '1' ||
      includeInactive === 'true' ||
      includeInactive === 'yes';
    return this._pos.listPlans(req.user as UserModel, all);
  }

  @Post('plans')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createPlan(@Req() req: Request, @Body() body: CreatePosLicensePlanDto) {
    return this._pos.createPlan(req.user as UserModel, body);
  }

  @Patch('plans/:planId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updatePlan(
    @Req() req: Request,
    @Param('planId') planId: string,
    @Body() body: UpdatePosLicensePlanDto,
  ) {
    return this._pos.updatePlan(req.user as UserModel, planId, body);
  }

  @Delete('plans/:planId')
  @UseGuards(JwtGuard)
  deactivatePlan(@Req() req: Request, @Param('planId') planId: string) {
    return this._pos.deactivatePlan(req.user as UserModel, planId);
  }

  @Get('vendor-licenses')
  @UseGuards(JwtGuard)
  listVendorLicenses(@Req() req: Request) {
    return this._pos.listVendorLicenses(req.user as UserModel);
  }

  @Put('vendor-licenses/:storeId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  upsertVendorLicense(
    @Req() req: Request,
    @Param('storeId') storeId: string,
    @Body() body: UpsertPosVendorLicenseDto,
  ) {
    return this._pos.upsertVendorLicense(req.user as UserModel, storeId, body);
  }

  @Delete('vendor-licenses/:storeId')
  @UseGuards(JwtGuard)
  deleteVendorLicense(
    @Req() req: Request,
    @Param('storeId') storeId: string,
  ) {
    return this._pos.deleteVendorLicense(req.user as UserModel, storeId);
  }
}
