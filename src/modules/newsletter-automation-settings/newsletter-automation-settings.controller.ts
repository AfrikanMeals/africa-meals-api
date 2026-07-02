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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateNewsletterAutomationSettingsDto } from './dto/update-newsletter-automation-settings.dto';
import { NewsletterAutomationSettingsService } from './newsletter-automation-settings.service';

@ApiTags('newsletter-automation-settings')
@Controller('platform/newsletter-automation-settings')
export class NewsletterAutomationSettingsController {
  constructor(
    private readonly _service: NewsletterAutomationSettingsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getPublic() {
    return this._service.getPublicSettings();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateNewsletterAutomationSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
