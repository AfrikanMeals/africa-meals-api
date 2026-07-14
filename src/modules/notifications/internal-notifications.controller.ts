import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalChatPushDto } from './dto/internal-chat-push.dto';
import { InternalInAppNotificationDto } from './dto/internal-in-app-notification.dto';
import { InternalSecretGuard } from './guards/internal-secret.guard';
import { NotificationsService } from './notifications.service';

/** Appelé par africa-meals-ws (secret partagé) pour pousser les nouveaux messages chat. */
@ApiExcludeController()
@Controller('internal/notifications')
@UseGuards(InternalSecretGuard)
export class InternalNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('chat-message')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async chatMessagePush(@Body() body: InternalChatPushDto) {
    await this.notifications.sendChatMessagePush({
      recipientUserIds: body.recipientUserIds,
      title: body.title,
      body: body.body,
      conversationId: body.conversationId,
      storeId: body.storeId,
      storeName: body.storeName,
      orderId: body.orderId,
      contextType: body.contextType,
      senderUserId: body.senderUserId,
      courierUserId: body.courierUserId,
    });
    return { ok: true };
  }

  /** Notification in-app persistée + push optionnel (services internes). */
  @Post('in-app')
  @HttpCode(201)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async inApp(@Body() body: InternalInAppNotificationDto) {
    return this.notifications.createUserScopedNotification({
      recipientUserId: body.recipientUserId,
      title: body.title,
      body: body.body,
      type: body.type,
      data: body.data,
      sendPush: body.sendPush === true,
    });
  }
}
