import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateMobileAppSettingsDto } from './dto/update-mobile-app-settings.dto';
import { MobileAppSettingsService } from './mobile-app-settings.service';

@ApiTags('mobile-app-settings')
@Controller('platform/mobile-app-settings')
export class MobileAppSettingsController {
  constructor(private readonly _service: MobileAppSettingsService) {}

  /** Lecture publique: page onboarding web + app mobile. */
  @Get()
  getPublic() {
    return this._service.getPublicSettings();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateMobileAppSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
