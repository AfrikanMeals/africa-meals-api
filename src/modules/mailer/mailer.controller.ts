import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MailerService } from './mailer.service';
import { TestEmailDto } from './dto/test-email.dto';

@ApiTags('mailer')
@Controller('mailer')
export class MailerController {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  @Post('test-email')
  async sendTestEmail(@Body(ValidationPipe) body: TestEmailDto) {
    const appName = this.configService.get<string>('APP_NAME') ?? 'Africa Meals';

    await this.mailerService.sendSimple({
      to: body.to,
      toName: 'Test',
      subject: `[TEST] Email - ${appName}`,
      html: `
        <h2>Email de test</h2>
        <p>Ceci confirme que l'envoi d'emails fonctionne pour <strong>${appName}</strong>.</p>
        <p>Si vous recevez ce message, la configuration e-mail (SMTP Gmail ou MailerSend) est correcte.</p>
        <p><em>Envoyé à ${new Date().toISOString()}</em></p>
      `.trim(),
      text: `Email de test - ${appName}. Envoi réussi. ${new Date().toISOString()}`,
    });

    return {
      success: true,
      message: `Email de test envoyé à ${body.to}`,
    };
  }
}
