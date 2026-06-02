import { TrackAdNotificationEventDto } from '@modules/ads/dto/ad-notification-tracking.dto';
import { AdNotificationService } from '@modules/ads/ad-notification.service';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

@ApiTags('ads')
@Controller('ads/notifications')
export class AdNotificationController {
  constructor(private readonly adNotifications: AdNotificationService) {}

  @Post('track')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Enregistre interaction ou conversion (app / web)',
  })
  async track(@Body() dto: TrackAdNotificationEventDto) {
    return this.adNotifications.trackEvent(dto);
  }

  /**
   * Clic e-mail / SMS : enregistre l’interaction et redirige vers l’app (deep link).
   */
  @Get('click/:deliveryId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Pont HTTPS → app pour notification pub' })
  async clickRedirect(
    @Param('deliveryId') deliveryId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const { deepLink, webFallback } =
        await this.adNotifications.recordClickAndResolveDeepLink(deliveryId);
      const safeDeep = deepLink.replace(/"/g, '&quot;');
      const safeWeb = webFallback.replace(/"/g, '&quot;');
      res.send(`<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${safeDeep}">
<title>Ouverture…</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5">
<p><strong>Ouverture de l’offre…</strong></p>
<p><a href="${safeDeep}">Ouvrir dans l’application</a></p>
<p style="font-size:0.9rem;color:#666"><a href="${safeWeb}">Lien web</a></p>
<script>setTimeout(function(){ window.location.href=${JSON.stringify(deepLink)}; }, 400);</script>
</body></html>`);
    } catch {
      res.status(404).send(
        '<!DOCTYPE html><html lang="fr"><body><p>Lien expiré ou invalide.</p></body></html>',
      );
    }
  }
}
