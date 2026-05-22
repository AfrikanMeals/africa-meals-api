import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { RefundAdminNoteDto } from './dto/refund-admin-action.dto';
import { RefundProcessingService } from './refund-processing.service';

@ApiTags('refunds')
@ApiBearerAuth('bearer')
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundProcessingService) {}

  @Get()
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'File des remboursements (admin ou vendeur lecture)' })
  list(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('take') take?: string,
  ) {
    const p = page != null ? Number(page) : undefined;
    const t = take != null ? Number(take) : undefined;
    return this.refunds.listRefundQueue(req.user as UserModel, {
      page: Number.isFinite(p) ? p : undefined,
      take: Number.isFinite(t) ? t : undefined,
    });
  }

  @Get('settings')
  @UseGuards(JwtGuard)
  settings() {
    return this.refunds.getProcessingSettings();
  }

  @Post('settings/pause')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  pauseGlobal(@Req() req: Request, @Body() body: RefundAdminNoteDto) {
    return this.refunds.pauseGlobalProcessing(
      req.user as UserModel,
      body.note,
    );
  }

  @Post('settings/resume')
  @UseGuards(JwtGuard)
  resumeGlobal(@Req() req: Request) {
    return this.refunds.resumeGlobalProcessing(req.user as UserModel);
  }

  @Post(':orderId/pause')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  pauseOne(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() body: RefundAdminNoteDto,
  ) {
    return this.refunds.pauseRefund(
      req.user as UserModel,
      orderId,
      body.note,
    );
  }

  @Post(':orderId/resume')
  @UseGuards(JwtGuard)
  resumeOne(@Req() req: Request, @Param('orderId') orderId: string) {
    return this.refunds.resumeRefund(req.user as UserModel, orderId);
  }

  @Post(':orderId/cancel')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  cancelOne(
    @Req() req: Request,
    @Param('orderId') orderId: string,
    @Body() body: RefundAdminNoteDto,
  ) {
    return this.refunds.cancelRefund(
      req.user as UserModel,
      orderId,
      body.note,
    );
  }

  @Post(':orderId/process')
  @UseGuards(JwtGuard)
  processOne(@Req() req: Request, @Param('orderId') orderId: string) {
    return this.refunds.processRefundForOrder({
      orderId,
      processedBy: 'admin',
      admin: req.user as UserModel,
    });
  }
}
