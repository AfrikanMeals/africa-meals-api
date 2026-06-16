import { NotificationsService } from '@modules/notifications/notifications.service';
import { FcmTestDto } from '@modules/notifications/dto/fcm-test.dto';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
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

import { JwtGuard } from './guards/jwt.guard';

const DEFAULT_TEST_TITLE = 'Test Wise Eat';
const DEFAULT_TEST_BODY =
  'Si vous voyez cette notification, FCM et les jetons enregistrés fonctionnent.';

@ApiTags('notifications')
@Controller('notifications')
export class FcmTestController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('fcm-test')
  @HttpCode(200)
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Envoyer une notification FCM de test',
    description:
      'Envoie une notification push à **votre compte** (tous les jetons enregistrés). ' +
      'Les comptes **ADMIN** peuvent cibler un autre utilisateur avec `targetUserId`. ' +
      'À utiliser depuis Swagger (Authorize) ou un client HTTP avec le JWT.',
  })
  @ApiResponse({
    status: 200,
    description: 'Résultat d’envoi FCM',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', example: true },
        sent: { type: 'number', example: 1 },
        failures: { type: 'number', example: 0 },
        deviceCount: {
          type: 'number',
          description: 'Nombre de jetons FCM ciblés avant envoi',
          example: 2,
        },
        message: {
          type: 'string',
          description: 'Présent si aucun jeton enregistré',
          example: 'Aucun jeton FCM pour cet utilisateur.',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'targetUserId réservé aux ADMIN' })
  async sendFcmTest(@Req() req: Request, @Body() body: FcmTestDto) {
    const me = req.user as UserModel;
    const myId = me._id.toString();

    let recipientId = myId;
    if (body.targetUserId?.trim()) {
      if (me.type !== UserTypeEnum.ADMIN) {
        throw new ForbiddenException(
          'Seuls les comptes ADMIN peuvent définir targetUserId.',
        );
      }
      recipientId = body.targetUserId.trim();
    }

    const title = (body.title?.trim() || DEFAULT_TEST_TITLE).slice(0, 120);
    const text = (body.body?.trim() || DEFAULT_TEST_BODY).slice(0, 500);

    const result = await this.notifications.sendFcmTestPush({
      recipientUserId: recipientId,
      title,
      body: text,
    });

    if (result.deviceCount === 0) {
      return {
        ok: true,
        sent: 0,
        failures: 0,
        deviceCount: 0,
        message:
          'Aucun jeton FCM pour cet utilisateur. Enregistrez un appareil (POST /auth/me/fcm-token) puis réessayez.',
      };
    }

    return {
      ok: true,
      sent: result.sent,
      failures: result.failures,
      deviceCount: result.deviceCount,
    };
  }
}
