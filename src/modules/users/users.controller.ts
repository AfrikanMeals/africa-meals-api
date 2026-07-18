import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { SetClientRewardProgramDto } from './dto/set-client-reward-program.dto';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { parseClientsPageQuery } from './dto/clients-page.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UsersService } from './users.service';
import { StoreSubscribersService } from '@modules/store-subscribers/store-subscribers.service';

@ApiTags('users', 'addresses')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  @Inject(UsersService)
  private readonly _usersService: UsersService;

  @Inject(StoreSubscribersService)
  private readonly _storeSubscribers: StoreSubscribersService;

  @Get('me/subscribed-stores')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Boutiques auxquelles le client est abonné' })
  async listMySubscribedStores(@Req() req: Request) {
    return this._storeSubscribers.listSubscribedStores(req.user as UserModel);
  }

  /**
   * Lookup username pour offrir un panier (profil minimal).
   * Erreurs : `username_invalid_format`, `user_not_found`, `cannot_gift_self`.
   */
  @Get('by-username/:username')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Profil public minimal par username (offrir panier — pas les gift codes promo)',
  })
  async lookupByUsername(
    @Req() req: Request,
    @Param('username') username: string,
  ) {
    return this._usersService.lookupByUsernameForGift(
      req.user as UserModel,
      username,
    );
  }

  /**
   * Adresses du destinataire pour le checkout cadeau (lecture seule).
   */
  @Get(':userId/gift-checkout-addresses')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Adresses livraison d’un destinataire (offrir panier) — pas de mutation',
  })
  async listGiftCheckoutAddresses(
    @Req() req: Request,
    @Param('userId') userId: string,
  ) {
    return this._usersService.listAddressesForGiftCheckout(
      req.user as UserModel,
      userId,
    );
  }

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

  @Patch('clients/:userId/reward-program')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Activer ou désactiver l’éligibilité fidélité d’un client (admin uniquement)',
  })
  async setClientRewardProgram(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Body(ValidationPipe) body: SetClientRewardProgramDto,
  ) {
    return this._usersService.setClientRewardProgramEligible(
      req.user as UserModel,
      userId,
      body.eligible,
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
