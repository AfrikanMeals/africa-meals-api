import {
  Body,
  Controller,
  HttpCode,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContactSubmissionService } from './contact-submission.service';
import { ContactDto } from './dto/contact.dto';
import { RecaptchaEnterpriseService } from './recaptcha-enterprise.service';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(
    private readonly contactSubmissionService: ContactSubmissionService,
    private readonly recaptchaEnterpriseService: RecaptchaEnterpriseService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Formulaire de contact du site vitrine (enregistrement puis envoi SMTP / MailerSend)',
  })
  async sendContactMessage(@Body(ValidationPipe) body: ContactDto) {
    if (body.website?.trim()) {
      return {
        success: true,
        message: 'Message reçu.',
      };
    }
    await this.recaptchaEnterpriseService.verify(
      body.recaptchaToken,
      'CONTACT_FORM_SUBMIT',
    );
    return this.contactSubmissionService.submit(body);
  }
}
