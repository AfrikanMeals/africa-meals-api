import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { CreateAppCheckSessionTokenDto } from './dto/create-app-check-session-token.dto';
import { CreateAppCheckTokenDto } from './dto/create-app-check-token.dto';
import { UpdateSecuritySettingsDto } from './dto/update-security-settings.dto';
import { SecuritySettingsService } from './security-settings.service';

@ApiTags('security-settings')
@Controller('platform/security-settings')
export class SecuritySettingsController {
  constructor(private readonly _service: SecuritySettingsService) {}

  /** Lecture publique : activation App Check côté admin, mobile et site vitrine. */
  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getPublic() {
    return this._service.getPublicSettings();
  }

  /**
   * Session longue (7 j, max Firebase) pour le mobile debug — sans JWT ni App Check.
   * Désactivé en production sauf APP_CHECK_SESSION_MINT_ENABLED=true.
   */
  @Post('app-check-session')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createAppCheckSession(@Body() body: CreateAppCheckSessionTokenDto) {
    return this._service.createAppCheckSessionToken(body);
  }

  @ApiBearerAuth('bearer')
  @Get('app-check-apps')
  @UseGuards(JwtGuard)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  listAppCheckApps(@Req() req: Request) {
    return this._service.listAppCheckApps(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Post('app-check-token')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createAppCheckToken(
    @Req() req: Request,
    @Body() body: CreateAppCheckTokenDto,
  ) {
    return this._service.createAppCheckReleaseToken(
      req.user as UserModel,
      body,
    );
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateSecuritySettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
