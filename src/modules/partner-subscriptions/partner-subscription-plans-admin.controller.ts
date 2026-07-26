import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
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
import {
  CreatePartnerSubscriptionPlanDto,
  UpdatePartnerSubscriptionPlanDto,
} from './dto/partner-subscription-plan.dto';
import { PartnerSubscriptionPlansService } from './partner-subscription-plans.service';

@ApiTags('partner-subscription-plans-admin')
@ApiBearerAuth('bearer')
@Controller('partner/admin/subscription-plans')
export class PartnerSubscriptionPlansAdminController {
  @Inject(PartnerSubscriptionPlansService)
  private readonly plans: PartnerSubscriptionPlansService;

  @Get()
  @UseGuards(JwtGuard)
  @ApiOperation({ summary: 'Admin — liste formules Partner' })
  list(
    @Req() req: Request,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const all =
      includeInactive === '1' ||
      includeInactive === 'true' ||
      includeInactive === 'yes';
    return this.plans.listPlansAdmin(req.user as UserModel, all);
  }

  @Post()
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  create(
    @Req() req: Request,
    @Body() body: CreatePartnerSubscriptionPlanDto,
  ) {
    return this.plans.createPlan(req.user as UserModel, body);
  }

  @Patch(':planId')
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  update(
    @Req() req: Request,
    @Param('planId') planId: string,
    @Body() body: UpdatePartnerSubscriptionPlanDto,
  ) {
    return this.plans.updatePlan(req.user as UserModel, planId, body);
  }

  @Delete(':planId')
  @UseGuards(JwtGuard)
  deactivate(@Req() req: Request, @Param('planId') planId: string) {
    return this.plans.deactivatePlan(req.user as UserModel, planId);
  }

  @Delete(':planId/permanent')
  @UseGuards(JwtGuard)
  permanentlyDelete(@Req() req: Request, @Param('planId') planId: string) {
    return this.plans.permanentlyDeletePlan(req.user as UserModel, planId);
  }
}
