import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import {
  UpdateEmailChannelSettingsDto,
  UpsertPlatformSmtpConfigDto,
} from './dto/email-channel-settings.dto';
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

  @Get('whatsapp/probe')
  @ApiOperation({ summary: 'Vérifie la configuration Bird WhatsApp' })
  probeWhatsappSettings(@Req() req: Request) {
    return this.channels.probeWhatsappSettings();
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

  @Get('telegram/probe')
  @ApiOperation({ summary: 'Vérifie la configuration Telegram Bot API' })
  probeTelegramSettings(@Req() req: Request) {
    return this.channels.probeTelegramSettings();
  }

  @Get('email')
  @ApiOperation({
    summary:
      'Paramètres Email — moteur d’envoi et configurations SMTP additionnelles',
  })
  getEmailSettings(@Req() req: Request) {
    return this.channels.getEmailSettings(req.user as UserModel);
  }

  @Get('email/probe')
  @ApiOperation({ summary: 'Vérifie la configuration d’un moteur Email platform' })
  probeEmailSettings(@Query('engine') engine?: string) {
    return this.channels.probeEmailEngine(engine)
  }

  @Patch('email')
  @ApiOperation({ summary: 'Met à jour le moteur Email plateforme' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateEmailSettings(
    @Req() req: Request,
    @Body() dto: UpdateEmailChannelSettingsDto,
  ) {
    return this.channels.updateEmailSettings(req.user as UserModel, dto);
  }

  @Post('email/smtp-configs')
  @ApiOperation({ summary: 'Ajoute une configuration SMTP additionnelle' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createSmtpConfig(
    @Req() req: Request,
    @Body() dto: UpsertPlatformSmtpConfigDto,
  ) {
    return this.channels.createSmtpConfig(req.user as UserModel, dto);
  }

  @Patch('email/smtp-configs/:configId')
  @ApiOperation({ summary: 'Met à jour une configuration SMTP additionnelle' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateSmtpConfig(
    @Req() req: Request,
    @Param('configId') configId: string,
    @Body() dto: UpsertPlatformSmtpConfigDto,
  ) {
    return this.channels.updateSmtpConfig(req.user as UserModel, configId, dto);
  }

  @Delete('email/smtp-configs/:configId')
  @ApiOperation({ summary: 'Supprime une configuration SMTP additionnelle' })
  deleteSmtpConfig(@Req() req: Request, @Param('configId') configId: string) {
    return this.channels.deleteSmtpConfig(req.user as UserModel, configId);
  }
}
