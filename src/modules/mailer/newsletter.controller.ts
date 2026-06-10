import {
  Body,
  Controller,
  HttpCode,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NewsletterSubscribeDto } from './dto/newsletter-subscribe.dto';
import { NewsletterSubscriptionService } from './newsletter-subscription.service';
import { RecaptchaEnterpriseService } from './recaptcha-enterprise.service';

@ApiTags('newsletter')
@Controller('newsletter')
export class NewsletterController {
  constructor(
    private readonly newsletterSubscriptionService: NewsletterSubscriptionService,
    private readonly recaptchaEnterpriseService: RecaptchaEnterpriseService,
  ) {}

  @Post('subscribe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Inscription newsletter depuis le pied de page du site vitrine',
  })
  async subscribe(@Body(ValidationPipe) body: NewsletterSubscribeDto) {
    if (body.website?.trim()) {
      return {
        success: true,
        message: 'Merci ! Vous êtes inscrit à la newsletter Wise Eat.',
      };
    }
    await this.recaptchaEnterpriseService.verify(
      body.recaptchaToken,
      'NEWSLETTER_SUBSCRIBE',
    );
    return this.newsletterSubscriptionService.subscribe(body);
  }
}
