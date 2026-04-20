import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  PostSupportChatMessageDto,
  PostSupportChatSatisfactionDto,
} from './dto/support-chat.dto';
import { SupportChatService } from './support-chat.service';

@ApiTags('support-chat')
@ApiBearerAuth('bearer')
@Controller('support-chat')
export class SupportChatController {
  constructor(private readonly _supportChat: SupportChatService) {}

  @Get('messages')
  @UseGuards(JwtGuard)
  async getMyMessages(@Req() req: Request) {
    return this._supportChat.listMyMessages(req.user as UserModel);
  }

  /** Déclaré avant POST messages pour éviter tout conflit de routage. */
  @Post('messages/satisfaction')
  @UseGuards(JwtGuard)
  async postSatisfaction(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PostSupportChatSatisfactionDto,
  ) {
    return this._supportChat.respondSatisfaction(
      req.user as UserModel,
      body.promptMessageId,
      body.satisfied,
    );
  }

  @Post('messages')
  @UseGuards(JwtGuard)
  async postMyMessage(
    @Req() req: Request,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PostSupportChatMessageDto,
  ) {
    return this._supportChat.postMyMessage(req.user as UserModel, body.text);
  }

  @Get('admin/conversations')
  @UseGuards(JwtGuard)
  async listAdminConversations(@Req() req: Request) {
    return this._supportChat.listConversationsForAdmin(req.user as UserModel);
  }

  @Get('admin/conversations/:participantId/messages')
  @UseGuards(JwtGuard)
  async getAdminThread(
    @Req() req: Request,
    @Param('participantId') participantId: string,
  ) {
    return this._supportChat.listThreadForAdmin(
      req.user as UserModel,
      participantId,
    );
  }

  @Post('admin/conversations/:participantId/messages')
  @UseGuards(JwtGuard)
  async postAdminReply(
    @Req() req: Request,
    @Param('participantId') participantId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: PostSupportChatMessageDto,
  ) {
    return this._supportChat.postAdminReply(
      req.user as UserModel,
      participantId,
      body.text,
    );
  }

  @Post('admin/conversations/:participantId/closure-request')
  @UseGuards(JwtGuard)
  async postClosureRequest(
    @Req() req: Request,
    @Param('participantId') participantId: string,
  ) {
    return this._supportChat.postClosureRequest(
      req.user as UserModel,
      participantId,
    );
  }
}
