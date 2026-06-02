import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EmailTemplateService } from './email-template.service';
import { MailerService } from './mailer.service';
import { TestEmailDto } from './dto/test-email.dto';

@ApiTags('mailer')
@Controller('mailer')
export class MailerController {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly emailTpl: EmailTemplateService,
  ) {}

  @Post('test-email')
  async sendTestEmail(@Body(ValidationPipe) body: TestEmailDto) {
    const appName =
      this.configService.get<string>('APP_NAME') ?? 'Africa Meals';

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
      text: `Email de test - ${appName}. Envoi réussi. ${new Date().toISOString()}`,
    });

    return {
      success: true,
      message: `Email de test envoyé à ${body.to}`,
    };
  }
}
