import { Body, Controller, Get, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AcceptStoreDriverInviteDto } from './dto/accept-store-driver-invite.dto';
import { StoreDeliveryDriversService } from './store-delivery-drivers.service';

@ApiTags('store-delivery-drivers')
@Controller('platform/store-driver-invites')
export class PlatformStoreDriverInvitesController {
  constructor(
    private readonly _storeDeliveryDrivers: StoreDeliveryDriversService,
  ) {}

  /** Aperçu public (landing web) — vérifie qu’une invitation est encore valide. */
  @Get('preview')
  @ApiOperation({
    summary: 'Aperçu public invitation livreur restaurant (token e-mail).',
  })
  preview(@Query('token') token: string) {
    return this._storeDeliveryDrivers.previewInvite(token);
  }

  /** Acceptation publique via le lien e-mail (sans ouvrir l’app mobile). */
  @Post('accept')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({
    summary: 'Accepter une invitation livreur restaurant via le token e-mail.',
  })
  accept(@Body() body: AcceptStoreDriverInviteDto) {
    return this._storeDeliveryDrivers.acceptInviteByToken(body.token);
  }
}
