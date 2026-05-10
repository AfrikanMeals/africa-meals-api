import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { PatchDeliveryAgentApplicationDto } from './dto/delivery-agent-application.dto';
import { DeliveryAgentService } from './delivery-agent.service';

@ApiTags('delivery-agent')
@ApiBearerAuth('bearer')
@Controller('delivery-agent')
export class DeliveryAgentController {
  @Inject(DeliveryAgentService)
  private readonly _deliveryAgent: DeliveryAgentService;

  @Get('application')
  @UseGuards(JwtGuard)
  @ApiOperation({
    summary:
      'Fiche candidature livreur (création brouillon implicite). Query includeFields pour alléger la charge réseau.',
  })
  async getApplication(@Req() req: Request) {
    return this._deliveryAgent.getOrCreateMine(req.user as UserModel);
  }

  @Patch('application')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async patchApplication(
    @Req() req: Request,
    @Body() dto: PatchDeliveryAgentApplicationDto,
  ) {
    return this._deliveryAgent.patchMine(req.user as UserModel, dto);
  }

  @Post('application/submit')
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Soumet la candidature pour validation.' })
  async submit(@Req() req: Request) {
    return this._deliveryAgent.submitMine(req.user as UserModel);
  }
}
