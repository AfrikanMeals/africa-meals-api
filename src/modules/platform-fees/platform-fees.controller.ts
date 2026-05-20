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
import { UpdatePlatformFeesDto } from './dto/update-platform-fees.dto';
import { PlatformFeesService } from './platform-fees.service';

@ApiTags('platform-fees')
@Controller('platform/fees')
export class PlatformFeesController {
  constructor(private readonly _platformFees: PlatformFeesService) {}

  @Get('checkout')
  @ApiOperation({
    summary:
      'Frais de transaction paiement commande (public, apps mobile)',
  })
  getPublicCheckoutFees() {
    return this._platformFees.getPublicCheckoutFees();
  }

  @ApiBearerAuth('bearer')
  @Get()
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Lire les frais plateforme (ADMIN)' })
  getSettings(@Req() req: Request) {
    return this._platformFees.getSettings(req.user as UserModel);
  }

  @ApiBearerAuth('bearer')
  @Put()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Mettre à jour les frais plateforme (ADMIN)' })
  updateSettings(
    @Req() req: Request,
    @Body() body: UpdatePlatformFeesDto,
  ) {
    return this._platformFees.updateSettings(req.user as UserModel, body);
  }
}
