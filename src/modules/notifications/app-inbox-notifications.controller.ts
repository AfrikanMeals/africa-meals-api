import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { CreateBroadcastNotificationDto } from '@modules/notifications/dto/create-broadcast-notification.dto';
import { MarkNotificationsReadDto } from '@modules/notifications/dto/mark-notifications-read.dto';
import { NotificationInboxQueryDto } from '@modules/notifications/dto/notification-inbox-query.dto';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class AppInboxNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('inbox')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Liste des notifications in-app (globales + personnelles)',
    description:
      'Retourne les notifications visibles pour l’utilisateur connecté, avec le statut lu/non lu. ' +
      'Pagination par `cursor` (`_id` de la dernière entrée de la page précédente).',
  })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  async inbox(@Req() req: Request, @Query() query: NotificationInboxQueryDto) {
    const me = req.user as UserModel;
    const limit = query.limit ?? 20;
    return this.notifications.listInboxForUser({
      userId: me._id.toString(),
      limit,
      cursor: query.cursor,
    });
  }

  @Post('inbox/read')
  @HttpCode(200)
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Marquer des notifications comme lues' })
  async markRead(@Req() req: Request, @Body() body: MarkNotificationsReadDto) {
    const me = req.user as UserModel;
    return this.notifications.markNotificationsRead(
      me._id.toString(),
      body.notificationIds,
    );
  }

  @Post('inbox/read-all')
  @HttpCode(200)
  @UseGuards(JwtGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Tout marquer comme lu (inbox visible)' })
  async markAllRead(@Req() req: Request) {
    const me = req.user as UserModel;
    return this.notifications.markAllNotificationsRead(me._id.toString());
  }

  @Post('broadcast')
  @HttpCode(201)
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Créer une notification globale (ADMIN)',
    description:
      'Enregistre une notification `GLOBAL` pour le centre de messages. ' +
      'Optionnellement envoie un push FCM à tous les utilisateurs avec au moins un jeton.',
  })
  @ApiResponse({ status: 403, description: 'Réservé aux comptes ADMIN' })
  async broadcast(
    @Req() req: Request,
    @Body() body: CreateBroadcastNotificationDto,
  ) {
    const me = req.user as UserModel;
    if (me.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException(
        'Seuls les comptes ADMIN peuvent diffuser une notification globale.',
      );
    }
    return this.notifications.createGlobalNotification({
      title: body.title,
      body: body.body,
      type: body.type,
      data: body.data,
      sendPush: body.sendPush === true,
    });
  }
}
