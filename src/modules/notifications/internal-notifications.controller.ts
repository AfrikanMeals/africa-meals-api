import { Body, Controller, HttpCode, Post, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalChatPushDto } from './dto/internal-chat-push.dto';
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
    });
    return { ok: true };
  }
}
