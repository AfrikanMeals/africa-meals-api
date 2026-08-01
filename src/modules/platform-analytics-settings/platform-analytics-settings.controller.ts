import { JwtGuard } from '@modules/auth/guards/jwt.guard';
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdatePlatformAnalyticsSettingsDto } from './dto/update-platform-analytics-settings.dto';
import { PlatformAnalyticsSettingsService } from './platform-analytics-settings.service';

@ApiTags('platform-analytics-settings')
@Controller('platform/analytics-settings')
export class PlatformAnalyticsSettingsController {
  constructor(private readonly _service: PlatformAnalyticsSettingsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  @ApiOperation({
    summary:
      'Toggles analytics (Matomo / GA / GTM / FB) par surface — lecture publique',
  })
  getPublic() {
    return this._service.getPublicSettings();
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Met à jour les toggles analytics (admin.settings)',
  })
  update(
    @Req() req: Request,
    @Body() body: UpdatePlatformAnalyticsSettingsDto,
  ) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
