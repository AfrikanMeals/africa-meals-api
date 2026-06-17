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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { SecretManagerScope } from '@schemas/secret-manager.schema';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateSecretManagerDto } from './dto/update-secret-manager.dto';
import { SecretManagerService } from './secret-manager.service';

@ApiTags('secret-manager')
@Controller('platform/secret-manager')
export class SecretManagerController {
  constructor(private readonly _service: SecretManagerService) {}

  @ApiBearerAuth('bearer')
  @Get()
  @UseGuards(JwtGuard)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  getAdmin(@Query('scope') scope?: SecretManagerScope) {
    if (scope === 'api' || scope === 'ws') {
      return this._service.getScopeView(scope);
    }
    return this._service.getAllScopesView();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateSecretManagerDto) {
    return this._service.updateSettings(req.user as UserModel, body);
  }
}
