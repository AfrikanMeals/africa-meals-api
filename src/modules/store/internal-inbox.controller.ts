import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalSecretGuard } from '@modules/notifications/guards/internal-secret.guard';
import { StoreService } from './store.service';

/** Fil boutique / compte pour africa-meals-ws (push WebSocket, sans polling client). */
@ApiExcludeController()
@Controller('internal/inbox')
@UseGuards(InternalSecretGuard)
export class InternalInboxController {
  constructor(private readonly storeService: StoreService) {}

  @Get('vendor-feed')
  async vendorFeed(@Query('userId') userId?: string) {
    return this.storeService.findNotificationFeedByUserId(userId ?? '');
  }
}
