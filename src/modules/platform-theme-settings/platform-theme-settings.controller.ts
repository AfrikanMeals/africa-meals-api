import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdatePlatformThemeSettingsDto } from './dto/update-platform-theme-settings.dto';
import { ThemeImageJsonDto } from './dto/theme-image.dto';
import { PlatformThemeSettingsService } from './platform-theme-settings.service';

@ApiTags('platform-theme-settings')
@Controller('platform/theme-settings')
export class PlatformThemeSettingsController {
  constructor(private readonly _service: PlatformThemeSettingsService) {}

  /** Lecture publique — mobile + admin (logos / fonds). */
  @Get()
  getPublic() {
    return this._service.getPublicSettings();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdatePlatformThemeSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }

  @ApiBearerAuth('bearer')
  @Post('image-json')
  @UseGuards(JwtGuard)
  uploadImageJson(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: ThemeImageJsonDto,
  ) {
    return this._service.uploadThemeImageJson(req.user as UserModel, body);
  }
}
