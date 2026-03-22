import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UsersService } from './users.service';

@ApiTags('users', 'addresses')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  @Inject(UsersService)
  private readonly _usersService: UsersService;

  /**
   * Clients finaux (`type: USER`).
   * - Administrateur : liste complète.
   * - Restaurant (`VENDOR`) : uniquement les clients ayant au moins une commande sur une de ses boutiques.
   */
  @Get('clients')
  @UseGuards(JwtGuard)
  async listClients(@Req() req: Request) {
    return this._usersService.listEndUserClients(req.user as UserModel);
  }

  @Post('address')
  @UseGuards(JwtGuard)
  async createAddress(
    @Req() req: Request,
    @Body(ValidationPipe) args: CreateAddressDto,
  ) {
    return this._usersService.createAddress(args, req.user as UserModel);
  }
}
