import {
  Body,
  Controller,
  Get,
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
import { UpdateAuthSettingsDto } from './dto/update-auth-settings.dto';
import { AuthSettingsService } from './auth-settings.service';

@ApiTags('auth-settings')
@Controller('platform/auth-settings')
export class AuthSettingsController {
  constructor(private readonly _service: AuthSettingsService) {}

  /** Lecture publique : écrans de connexion admin + mobile. */
  @Get()
  getPublic() {
    return this._service.getPublicSettings();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateAuthSettingsDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
