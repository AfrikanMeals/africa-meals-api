import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { RecordUsageSessionDto } from './dto/record-usage-session.dto';
import { UsageTimeService } from './usage-time.service';

@ApiTags('Usage time')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('usage-time')
export class UsageTimeController {
  constructor(private readonly usageTime: UsageTimeService) {}

  @Post('sessions')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary: 'Enregistre début / heartbeat / fin de session (mobile ou admin)',
  })
  recordSession(@Req() req: Request, @Body() dto: RecordUsageSessionDto) {
    return this.usageTime.recordSession(req.user as UserModel, dto);
  }
}
