import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('platform')
@Controller('platform/subscription-plans')
export class PlatformSubscriptionPlansController {
  @Inject(SubscriptionsService)
  private readonly subscriptions: SubscriptionsService;

  /** Lecture publique : page tarifs du site vitrine. */
  @Get()
  listPublic() {
    return this.subscriptions.listPublicPlans();
  }
}
