import { JwtGuard } from '@modules/auth/guards/jwt.guard';
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdatePlatformFeatureModulesDto } from './dto/update-platform-feature-modules.dto';
import { PlatformFeatureModulesService } from './platform-feature-modules.service';

@ApiTags('platform-feature-modules')
@Controller('platform/feature-modules')
export class PlatformFeatureModulesController {
  constructor(private readonly _service: PlatformFeatureModulesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Modules fonctionnels activés (portail admin et app mobile, lecture publique)',
  })
  getPublic() {
    return this._service.getPublicSettings();
  }

  @Put()
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Met à jour les modules (admin plateforme uniquement)' })
  update(
    @Req() req: Request,
    @Body() body: UpdatePlatformFeatureModulesDto,
  ) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
