import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalSecretGuard } from '@modules/notifications/guards/internal-secret.guard';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { StoreService } from './store.service';

/** Fil boutique / compte pour africa-meals-ws (push WebSocket, sans polling client). */
@ApiExcludeController()
@Controller('internal/inbox')
@UseGuards(InternalSecretGuard)
export class InternalInboxController {
  constructor(
    private readonly storeService: StoreService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('vendor-feed')
  async vendorFeed(@Query('userId') userId?: string) {
    const uid = userId?.trim() ?? '';
    const [vendorFeed, appInbox] = await Promise.all([
      this.storeService.findNotificationFeedByUserId(uid),
      uid
        ? this.notifications.listInboxForUser({ userId: uid, limit: 12 })
        : Promise.resolve({ items: [], nextCursor: null, unreadCount: 0 }),
    ]);
    return {
      items: vendorFeed.items ?? [],
      appInboxItems: appInbox.items,
      appInboxUnreadCount: appInbox.unreadCount,
    };
  }
}
