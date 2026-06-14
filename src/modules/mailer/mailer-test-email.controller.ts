import { AdminGuard } from '@modules/auth/guards/admin.guard';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EmailTemplateService } from './email-template.service';
import { MailerTestEmailRateLimitGuard } from './guards/mailer-test-email-rate-limit.guard';
import { TestEmailDto } from './dto/test-email.dto';
import { MailerService } from './mailer.service';

@ApiTags('mailer')
@Controller('mailer')
export class MailerTestEmailController {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly emailTpl: EmailTemplateService,
  ) {}

  @Post('test-email')
  @HttpCode(200)
  @UseGuards(JwtGuard, AdminGuard, MailerTestEmailRateLimitGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Envoyer un e-mail de test (ADMIN, dev/staging uniquement)',
    description:
      'Route diagnostic désactivée en production. Requiert `ENABLE_MAILER_TEST_EMAIL=true`, un JWT ADMIN et respecte une limite de 5 envois / 15 min.',
  })
  @ApiResponse({ status: 200, description: 'E-mail de test envoyé' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Réservé aux ADMIN' })
  @ApiResponse({ status: 429, description: 'Limite de débit atteinte' })
  async sendTestEmail(@Body() body: TestEmailDto) {
    const appName = this.configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const sentAt = new Date().toISOString();

    await this.mailerService.sendSimple({
      to: body.to,
      toName: 'Test',
      subject: `[TEST] Email - ${appName}`,
      html: [
        this.emailTpl.heading('Email de test'),
        this.emailTpl.paragraph(
          `Ceci confirme que l'envoi d'e-mails fonctionne pour <strong>${this.emailTpl.escapeHtml(appName)}</strong>.`,
        ),
        this.emailTpl.paragraph(
          'Si vous recevez ce message, la configuration e-mail (SMTP ou MailerSend) et la mise en page sont correctes.',
        ),
        this.emailTpl.muted(`Envoyé le ${this.emailTpl.escapeHtml(sentAt)}`),
      ].join('\n'),
      text: `Email de test - ${appName}. Envoi réussi. ${sentAt}`,
    });

    return {
      success: true,
      message: `Email de test envoyé à ${body.to}`,
    };
  }
}
