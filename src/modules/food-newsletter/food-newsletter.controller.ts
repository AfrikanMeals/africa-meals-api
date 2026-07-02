import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { FoodNewsletterTrackingService } from './food-newsletter-tracking.service';

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

@ApiTags('food-newsletter')
@Controller('food-newsletter')
export class FoodNewsletterController {
  constructor(private readonly tracking: FoodNewsletterTrackingService) {}

  @Get('o/:scheduleId.gif')
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Pixel ouverture newsletter food' })
  async openPixel(
    @Param('scheduleId') scheduleId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    await this.tracking.recordOpen(scheduleId, token);
    res.status(200).send(PIXEL);
  }

  @Get('r/:scheduleId')
  @ApiOperation({ summary: 'Redirect CTA tracké newsletter food' })
  async clickRedirect(
    @Param('scheduleId') scheduleId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const target = await this.tracking.recordClick(scheduleId, token);
    if (!target) {
      res.status(404).send('Lien invalide ou expiré.');
      return;
    }
    res.redirect(302, target);
  }

  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Désabonnement newsletter food one-click' })
  async unsubscribe(
    @Query('scheduleId') scheduleId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const ok = await this.tracking.unsubscribe(scheduleId, token);
    if (!ok) {
      res.status(400).send('Lien de désabonnement invalide ou expiré.');
      return;
    }
    res.status(200).send(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem"><h1>Désabonnement confirmé</h1><p>Vous ne recevrez plus d’e-mails de recommandations Wise Eat.</p></body></html>',
    );
  }
}
