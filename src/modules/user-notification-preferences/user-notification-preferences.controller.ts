import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { UpdateUserNotificationPreferencesDto } from './dto/update-user-notification-preferences.dto';
import { UserNotificationPreferencesService } from './user-notification-preferences.service';

@ApiTags('user-notification-preferences')
@ApiBearerAuth('bearer')
@Controller('users/me/notification-preferences')
@UseGuards(JwtGuard)
export class UserNotificationPreferencesController {
  constructor(private readonly service: UserNotificationPreferencesService) {}

  @Get()
  getMine(@Req() req: Request) {
    return this.service.getOrCreate(String((req.user as UserModel)._id));
  }

  @Patch()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateMine(
    @Req() req: Request,
    @Body() body: UpdateUserNotificationPreferencesDto,
  ) {
    return this.service.updateForUser(req.user as UserModel, body);
  }
}
