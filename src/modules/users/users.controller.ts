import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import {
  parseClientsPageQuery,
} from './dto/clients-page.dto';
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
   * Clients finaux.
   * - Administrateur : comptes `USER` + tout compte ayant commandé sur l’app.
   * - Restaurant (`VENDOR`) : comptes ayant commandé sur une de ses boutiques (tous rôles).
   */
  @Get('clients')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Clients finaux triés par total d’achats (pagination optionnelle via page/take)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async listClients(
    @Req() req: Request,
    @Query('page') pageRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const paginated = pageRaw != null || takeRaw != null;
    if (!paginated) {
      return this._usersService.listEndUserClients(req.user as UserModel);
    }
    const { page, take } = parseClientsPageQuery(pageRaw, takeRaw);
    return this._usersService.listEndUserClientsPage(
      req.user as UserModel,
      page,
      take,
    );
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
