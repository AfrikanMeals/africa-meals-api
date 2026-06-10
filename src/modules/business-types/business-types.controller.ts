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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { BusinessTypesService } from './business-types.service';
import { UpdateBusinessTypesDto } from './dto/update-business-types.dto';

@ApiTags('business-types')
@Controller('platform/business-types')
export class BusinessTypesController {
  constructor(private readonly _service: BusinessTypesService) {}

  /** Types actifs pour les formulaires vendeur (public). */
  @Get()
  getPublic() {
    return this._service.getPublicTypes();
  }

  @ApiBearerAuth('bearer')
  @Get('admin')
  @UseGuards(JwtGuard)
  getAdmin() {
    return this._service.getAdminTypes();
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(@Req() req: Request, @Body() body: UpdateBusinessTypesDto) {
    return this._service.updateTypes(req.user as UserModel, body);
  }
}
