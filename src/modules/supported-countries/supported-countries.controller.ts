import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AdminSupportedCountriesUpdateDto } from './dto/admin-supported-countries.dto';
import { SupportedCountriesService } from './supported-countries.service';

@ApiTags('supported-countries')
@Controller('supported-countries')
export class SupportedCountriesController {
  constructor(
    private readonly _supportedCountries: SupportedCountriesService,
    private readonly _storeAccess: StoreAccessService,
  ) {}

  @Get()
  async list() {
    const countries = await this._supportedCountries.listActive();
    return { countries };
  }

  @Get('admin/all')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async listForAdmin(@Req() req: Request) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    const countries = await this._supportedCountries.listAllForAdmin();
    return { countries };
  }

  @Put('admin/all')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async saveForAdmin(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: AdminSupportedCountriesUpdateDto,
  ) {
    await this._storeAccess.assertAdminPermission(
      req.user as UserModel,
      'admin.settings',
    );
    await this._supportedCountries.saveAllForAdmin(body.countries ?? []);
    return { ok: true };
  }
}
