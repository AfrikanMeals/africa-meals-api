import {
  Body,
  Controller,
  Get,
  Header,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateAuthSettingsDto } from './dto/update-auth-settings.dto';
import { AuthSettingsService } from './auth-settings.service';

@ApiTags('auth-settings')
@Controller('platform/auth-settings')
export class AuthSettingsController {
  constructor(private readonly _service: AuthSettingsService) {}

  /** Lecture publique : écrans de connexion admin + mobile. */
  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @ApiQuery({
    name: 'platform',
    required: false,
    enum: ['admin', 'mobile'],
    description:
      'Filtre OAuth par plateforme. Sans paramètre : réponse complète (admin + mobile).',
  })
  getPublic(@Query('platform') platform?: string) {
    const scope =
      platform === 'admin' || platform === 'mobile' ? platform : 'full';
    return this._service.getPublicSettings(scope);
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateAuthSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
