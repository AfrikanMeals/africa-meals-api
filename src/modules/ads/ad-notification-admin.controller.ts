import { AdNotificationService } from '@modules/ads/ad-notification.service';
import { SendAdNotificationTestDto } from '@modules/ads/dto/send-ad-notification-test.dto';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';

@ApiTags('Admin — Ad notifications test')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('db-maintenance/admin/ad-notification-test')
export class AdNotificationAdminController {
  constructor(private readonly adNotifications: AdNotificationService) {}

  @Get('context')
  @ApiOperation({
    summary:
      'Canaux actifs + bannières/campagnes actives (test manuel admin)',
  })
  getContext(@Req() req: Request) {
    return this.adNotifications.getAdminTestContext(req.user as UserModel);
  }

  @Post('send')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Envoie une notification pub de test à un utilisateur',
  })
  send(@Req() req: Request, @Body() dto: SendAdNotificationTestDto) {
    return this.adNotifications.sendAdminTest(req.user as UserModel, dto);
  }
}
