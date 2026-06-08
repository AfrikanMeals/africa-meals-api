import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LoyaltyService } from './loyalty.service';

@ApiTags('platform')
@Controller('platform/promo-program')
export class PlatformPromoProgramController {
  @Inject(LoyaltyService)
  private readonly loyalty: LoyaltyService;

  /** Lecture publique : page récompenses & promos du site vitrine. */
  @Get()
  listPublic() {
    return this.loyalty.listPublicPromoProgram();
  }
}
