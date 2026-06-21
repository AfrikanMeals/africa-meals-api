import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateWhatsappChannelSettingsDto } from './dto/update-whatsapp-channel-settings.dto';
import { UpdateTelegramChannelSettingsDto } from './dto/update-telegram-channel-settings.dto';
import { PlatformChannelsService } from './platform-channels.service';

@ApiTags('Admin — Platform channels')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('platform/channels')
export class PlatformChannelsController {
  constructor(private readonly channels: PlatformChannelsService) {}

  @Get('whatsapp')
  @ApiOperation({
    summary:
      'Paramètres WhatsApp (Bird) — credentials DB avec fallback .env / Secret Manager',
  })
  getWhatsappSettings(@Req() req: Request) {
    return this.channels.getWhatsappSettings(req.user as UserModel);
  }

  @Patch('whatsapp')
  @ApiOperation({ summary: 'Met à jour les credentials Bird WhatsApp' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateWhatsappSettings(
    @Req() req: Request,
    @Body() dto: UpdateWhatsappChannelSettingsDto,
  ) {
    return this.channels.updateWhatsappSettings(req.user as UserModel, dto);
  }

  @Get('telegram')
  @ApiOperation({
    summary:
      'Paramètres Telegram — credentials DB avec fallback .env / Secret Manager',
  })
  getTelegramSettings(@Req() req: Request) {
    return this.channels.getTelegramSettings(req.user as UserModel);
  }

  @Patch('telegram')
  @ApiOperation({ summary: 'Met à jour les credentials Telegram Bot API' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateTelegramSettings(
    @Req() req: Request,
    @Body() dto: UpdateTelegramChannelSettingsDto,
  ) {
    return this.channels.updateTelegramSettings(req.user as UserModel, dto);
  }
}
