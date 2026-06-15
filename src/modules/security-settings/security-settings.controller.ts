import {
  Body,
  Controller,
  Get,
  Header,
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

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateSecuritySettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
