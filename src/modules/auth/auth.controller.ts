import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { isAllowedGzipUploadMime } from 'src/incoming-upload-file';
import { memoryStorage } from 'multer';
import { TeamsService } from '@modules/teams/teams.service';
import { AuthService } from './auth.service';
import {
  ChatMediaJsonDto,
  ChatVoiceJsonDto,
  ChangePasswordDto,
  CheckAccountDto,
  Email2faConfirmDto,
  EmailVerificationDto,
  ForgotPasswordDto,
  AppleAuthDto,
  FacebookAuthDto,
  GoogleAuthDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  RegisterFcmTokenDto,
  RemoveFcmTokenDto,
  Resend2faLoginDto,
  ResetPasswordDto,
  UpdateProfileDto,
  Verify2faLoginDto,
} from './dto/auth.dto';
import { JwtGuard } from './guards/jwt.guard';
import { buildLoginRequestContext } from './login-notification/login-request-context.util';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  @Inject(AuthService)
  private readonly _authService: AuthService;

  @Inject(NotificationsService)
  private readonly _notifications: NotificationsService;

  @Inject(TeamsService)
  private readonly _teamsService: TeamsService;

  @Post('register')
  async register(@Body(ValidationPipe) args: RegisterDto, @Req() req: Request) {
    this.logger.log(
      `[POST /auth/register] corps validé email=${args.email} fullName=${
        args.fullName
      } source=${args.source} signupRole=${args.signupRole ?? '—'}`,
    );
    return this._authService.register(args, buildLoginRequestContext(req));
  }

  /** Étape 1 : envoi du code — pas encore de ligne dans `users` (sauf mode sans SMTP / compte test). */
  @Post('register/start')
  async registerStart(@Body(ValidationPipe) args: RegisterDto, @Req() req: Request) {
    this.logger.log(
      `[POST /auth/register/start] email=${args.email} fullName=${args.fullName}`,
    );
    return this._authService.registerStart(args, buildLoginRequestContext(req));
  }

  /** Étape 2 : validation du code et création du compte. */
  @Post('register/complete')
  async registerComplete(
    @Body(ValidationPipe) args: EmailVerificationDto,
    @Req() req: Request,
  ) {
    return this._authService.registerComplete(args, buildLoginRequestContext(req));
  }

  @Post('register/resend-code')
  async resendPendingSignup(@Body(ValidationPipe) args: ForgotPasswordDto) {
    return this._authService.resendPendingSignupCode(args.email);
  }

  @Post('login')
  async login(@Body(ValidationPipe) args: LoginDto, @Req() req: Request) {
    this.logger.log(`login body: ${JSON.stringify(args)}`);
    return this._authService.login(args, buildLoginRequestContext(req));
  }

  @Post('login/verify-2fa')
  async verify2faLogin(
    @Body(ValidationPipe) args: Verify2faLoginDto,
    @Req() req: Request,
  ) {
    return this._authService.verify2faLogin(args, buildLoginRequestContext(req));
  }

  @Post('login/resend-2fa')
  async resend2faLogin(@Body(ValidationPipe) args: Resend2faLoginDto) {
    return this._authService.resend2faLogin(args);
  }

  @Post('refresh')
  async refresh(@Body(ValidationPipe) args: RefreshTokenDto) {
    return this._authService.refreshSession(args.refreshToken);
  }

  @Post('google')
  async authWithGoogle(
    @Body(ValidationPipe) args: GoogleAuthDto,
    @Req() req: Request,
  ) {
    this.logger.log(
      `google auth: idToken présent (longueur=${args.idToken?.length ?? 0})`,
    );
    return this._authService.authWithGoogle(args, buildLoginRequestContext(req));
  }

  @Post('admin/google')
  async authWithGoogleAdmin(
    @Body(ValidationPipe) args: GoogleAuthDto,
    @Req() req: Request,
  ) {
    this.logger.log(
      `admin google auth: idToken présent (longueur=${
        args.idToken?.length ?? 0
      })`,
    );
    return this._authService.authWithGoogleAsVendor(
      args,
      buildLoginRequestContext(req),
    );
  }

  @Post('apple')
  async authWithApple(
    @Body(ValidationPipe) args: AppleAuthDto,
    @Req() req: Request,
  ) {
    this.logger.log(
      `apple auth: idToken présent (longueur=${args.idToken?.length ?? 0})`,
    );
    return this._authService.authWithApple(args, buildLoginRequestContext(req));
  }

  @Post('admin/apple')
  async authWithAppleAdmin(
    @Body(ValidationPipe) args: AppleAuthDto,
    @Req() req: Request,
  ) {
    this.logger.log(
      `admin apple auth: idToken présent (longueur=${
        args.idToken?.length ?? 0
      })`,
    );
    return this._authService.authWithAppleAsVendor(
      args,
      buildLoginRequestContext(req),
    );
  }

  @Post('facebook')
  async authWithFacebook(
    @Body(ValidationPipe) args: FacebookAuthDto,
    @Req() req: Request,
  ) {
    this.logger.log(
      `facebook auth: idToken présent (longueur=${args.idToken?.length ?? 0})`,
    );
    return this._authService.authWithFacebook(args, buildLoginRequestContext(req));
  }

  @Post('admin/facebook')
  async authWithFacebookAdmin(
    @Body(ValidationPipe) args: FacebookAuthDto,
    @Req() req: Request,
  ) {
    this.logger.log(
      `admin facebook auth: idToken présent (longueur=${
        args.idToken?.length ?? 0
      })`,
    );
    return this._authService.authWithFacebookAsVendor(
      args,
      buildLoginRequestContext(req),
    );
  }

  @Post('verify-email')
  async verifyEmail(@Body(ValidationPipe) args: EmailVerificationDto) {
    this.logger.log(`verify-email body: ${JSON.stringify(args)}`);
    return this._authService.verifyEmail(args);
  }

  /** Alias pour compatibilité : POST /auth/verify */
  @Post('verify')
  async verify(@Body(ValidationPipe) args: EmailVerificationDto) {
    this.logger.log(`verify body: ${JSON.stringify(args)}`);
    return this._authService.verifyEmail(args);
  }

  @Post('resend-verification-code')
  async resendVerificationCode(@Body('email', ValidationPipe) email: string) {
    this.logger.log(`resend-verification-code body: { email: ${email} }`);
    return this._authService.resendVerificationCode(email);
  }

  @Post('forgot-password')
  async forgotPassword(@Body(ValidationPipe) args: ForgotPasswordDto) {
    this.logger.log(`forgot-password email=${args.email}`);
    return this._authService.forgotPassword(args);
  }

  @Post('reset-password')
  async resetPassword(@Body(ValidationPipe) args: ResetPasswordDto) {
    this.logger.log(`reset-password body: ${JSON.stringify(args)}`);
    return this._authService.resetPassword(args);
  }

  @Post('check-account')
  async checkAccount(@Body(ValidationPipe) args: CheckAccountDto) {
    return this._authService.checkAccount(args);
  }

  @Get('me/rewards')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async getMyRewards(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.getMyRewards(user._id.toString());
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async getMe(@Req() req: Request) {
    const user = req.user as UserModel;
    const access = await this._teamsService.buildAccessPayload(user);
    const deletionPending =
      user.accountDeletionRequestedAt instanceof Date &&
      user.accountDeletionScheduledFor instanceof Date;
    const plain =
      typeof (user as { toObject?: () => Record<string, unknown> }).toObject ===
      'function'
        ? (user as { toObject: () => Record<string, unknown> }).toObject()
        : { ...(user as unknown as Record<string, unknown>) };
    return { ...plain, access, accountDeletionPending: deletionPending };
  }

  @Post('me/fcm-token')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Enregistrer un jeton FCM (notifications push)' })
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async registerFcmToken(
    @Req() req: Request,
    @Body() body: RegisterFcmTokenDto,
  ) {
    const user = req.user as UserModel;
    await this._notifications.registerUserFcmToken(
      user._id.toString(),
      body.token,
      body.platform,
    );
    return { ok: true };
  }

  @Delete('me/fcm-token')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Retirer un jeton FCM' })
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async removeFcmToken(@Req() req: Request, @Body() body: RemoveFcmTokenDto) {
    const user = req.user as UserModel;
    await this._notifications.removeUserFcmToken(
      user._id.toString(),
      body.token,
    );
    return { ok: true };
  }

  @Delete('me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async deleteAccount(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.requestAccountDeletion(user._id.toString());
  }

  @Get('me/deletion-status')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async getAccountDeletionStatus(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.getAccountDeletionStatus(user._id.toString());
  }

  @Post('me/cancel-deletion')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async cancelAccountDeletion(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.cancelAccountDeletion(user._id.toString());
  }

  @Get('admin/deletion-requests')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async listDeletionRequests(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.listAccountDeletionRequests(user._id.toString());
  }

  @Post('admin/deletion-requests/:userId/cancel')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async adminCancelDeletionRequest(
    @Req() req: Request,
    @Param('userId') userId: string,
  ) {
    const user = req.user as UserModel;
    return this._authService.adminCancelAccountDeletion(
      user._id.toString(),
      userId,
    );
  }

  @Delete('admin/deletion-requests/:userId')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async adminDeleteAccountNow(
    @Req() req: Request,
    @Param('userId') userId: string,
  ) {
    const user = req.user as UserModel;
    return this._authService.adminDeleteAccountNow(user._id.toString(), userId);
  }

  @Patch('me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async updateProfile(
    @Req() req: Request,
    @Body(ValidationPipe) args: UpdateProfileDto,
  ) {
    const user = req.user as UserModel;
    return this._authService.updateProfile(user._id.toString(), args);
  }

  @Get('me/security')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Paramètres de sécurité du compte (2FA, mot de passe)' })
  @UseGuards(JwtGuard)
  async getSecuritySettings(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.getSecuritySettings(user._id.toString());
  }

  @Post('me/change-password')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Changer le mot de passe (compte e-mail)' })
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async changePassword(
    @Req() req: Request,
    @Body() body: ChangePasswordDto,
  ) {
    const user = req.user as UserModel;
    return this._authService.changePassword(user._id.toString(), body);
  }

  @Post('me/email-2fa/request-enable')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Demander l’activation 2FA par e-mail (envoi code)' })
  @UseGuards(JwtGuard)
  async requestEmail2faEnable(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.requestEmail2faEnable(user._id.toString());
  }

  @Post('me/email-2fa/confirm-enable')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Confirmer l’activation 2FA avec le code e-mail' })
  @UseGuards(JwtGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async confirmEmail2faEnable(
    @Req() req: Request,
    @Body() body: Email2faConfirmDto,
  ) {
    const user = req.user as UserModel;
    return this._authService.confirmEmail2faEnable(
      user._id.toString(),
      body,
    );
  }

  @Post('me/chat-voice')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024, files: 1 },
      fileFilter: (req, file, cb) => {
        if (isAllowedGzipUploadMime(file.mimetype)) {
          return cb(null, true);
        }
        if (
          !file.mimetype.match(
            /^(audio\/(mpeg|mp4|webm|wav|x-m4a|aac|3gpp)|video\/webm)$/i,
          ) &&
          !file.originalname.match(/\.(m4a|mp3|aac|wav|webm|ogg)$/i)
        ) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadChatVoice(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file_not_provided');
    }
    const user = req.user as UserModel;
    return this._authService.uploadChatVoiceFile(
      user._id.toString(),
      file,
      user,
    );
  }

  /** Même effet que `chat-voice` mais corps JSON — évite multipart tronqué derrière certains hébergeurs. */
  @Post('me/chat-voice-json')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async uploadChatVoiceJson(
    @Req() req: Request,
    @Body(ValidationPipe) body: ChatVoiceJsonDto,
  ) {
    const raw = body.audioBase64
      .replace(/\s/g, '')
      .replace(/^data:audio\/[^;]+;base64,/i, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid_base64');
    }
    if (!buffer.length) {
      throw new BadRequestException('empty_audio');
    }
    const max = 15 * 1024 * 1024;
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name = (body.filename || 'recording.webm').trim() || 'recording.webm';
    const mimeIn = (body.mimeType || '').trim();
    const nameOk = /\.(m4a|mp3|aac|wav|webm|ogg)$/i.test(name);
    const mimeOk =
      /^(audio\/(mpeg|mp4|webm|wav|x-m4a|aac|3gpp)|video\/webm)$/i.test(mimeIn);
    if (!nameOk && !mimeOk) {
      throw new BadRequestException('invalid_file_type');
    }
    let mimetype = mimeIn;
    if (!mimetype) {
      const lower = name.toLowerCase();
      if (lower.endsWith('.webm')) mimetype = 'audio/webm';
      else if (lower.endsWith('.m4a')) mimetype = 'audio/mp4';
      else if (lower.endsWith('.mp3')) mimetype = 'audio/mpeg';
      else if (lower.endsWith('.wav')) mimetype = 'audio/wav';
      else if (lower.endsWith('.ogg')) mimetype = 'audio/ogg';
      else if (lower.endsWith('.aac')) mimetype = 'audio/aac';
      else mimetype = 'audio/webm';
    }
    const file = {
      fieldname: 'file',
      originalname: name,
      encoding: '7bit',
      mimetype,
      buffer,
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: undefined,
    } as Express.Multer.File;
    const user = req.user as UserModel;
    return this._authService.uploadChatVoiceFile(
      user._id.toString(),
      file,
      user,
    );
  }

  @Post('me/chat-media')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
      fileFilter: (req, file, cb) => {
        if (isAllowedGzipUploadMime(file.mimetype)) {
          return cb(null, true);
        }
        const mime = (file.mimetype || '').toLowerCase();
        const ok =
          /^image\/(jpeg|png|gif|webp|heic|heif)$/i.test(mime) ||
          /^application\/pdf$/i.test(mime) ||
          /^application\/(zip|x-zip-compressed)$/i.test(mime) ||
          /^text\/plain$/i.test(mime) ||
          /^application\/msword$/i.test(mime) ||
          /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$/i.test(
            mime,
          );
        if (!ok) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadChatMedia(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file_not_provided');
    }
    const user = req.user as UserModel;
    return this._authService.uploadChatMediaFile(
      user._id.toString(),
      file,
      user,
    );
  }

  /** Même effet que `chat-media` mais corps JSON — évite multipart tronqué (Firebase / CF / proxys). */
  @Post('me/chat-media-json')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async uploadChatMediaJson(
    @Req() req: Request,
    @Body(ValidationPipe) body: ChatMediaJsonDto,
  ) {
    const raw = body.fileBase64
      .replace(/\s/g, '')
      .replace(/^data:[^;]+;base64,/i, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid_base64');
    }
    if (!buffer.length) {
      throw new BadRequestException('empty_file');
    }
    const max = 20 * 1024 * 1024;
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name = (body.filename || 'file').trim() || 'file';
    let mimetype = (body.mimeType || '').trim();
    if (!mimetype) {
      const inferred = inferChatMediaMimeFromFilename(name);
      if (!inferred) {
        throw new BadRequestException('invalid_file_type');
      }
      mimetype = inferred;
    }
    if (!isAllowedChatMediaMime(mimetype)) {
      throw new BadRequestException('invalid_file_type');
    }
    const file = {
      fieldname: 'file',
      originalname: name,
      encoding: '7bit',
      mimetype,
      buffer,
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: undefined,
    } as Express.Multer.File;
    const user = req.user as UserModel;
    return this._authService.uploadChatMediaFile(
      user._id.toString(),
      file,
      user,
    );
  }

  @Patch('me/profile-image')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5 MB
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|webp)$/i)) {
          return cb(new Error('invalid_file_type'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadProfileImage(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file_not_provided');
    }
    const user = req.user as UserModel;
    return this._authService.updateProfileImage(
      user._id.toString(),
      file,
      user,
    );
  }

  @Delete('me/profile-image')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async removeProfileImage(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.removeProfileImage(user._id.toString(), user);
  }
}

function inferChatMediaMimeFromFilename(name: string): string | null {
  const lower = name.toLowerCase();
  if (/\.(jpe?g)$/i.test(lower)) return 'image/jpeg';
  if (/\.png$/i.test(lower)) return 'image/png';
  if (/\.gif$/i.test(lower)) return 'image/gif';
  if (/\.webp$/i.test(lower)) return 'image/webp';
  if (/\.heic$/i.test(lower)) return 'image/heic';
  if (/\.heif$/i.test(lower)) return 'image/heif';
  if (/\.pdf$/i.test(lower)) return 'application/pdf';
  if (/\.zip$/i.test(lower)) return 'application/zip';
  if (/\.txt$/i.test(lower)) return 'text/plain';
  if (/\.doc$/i.test(lower)) return 'application/msword';
  if (/\.docx$/i.test(lower)) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (/\.xlsx$/i.test(lower)) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (/\.xls$/i.test(lower)) return 'application/vnd.ms-excel';
  if (/\.pptx$/i.test(lower)) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  if (/\.ppt$/i.test(lower)) return 'application/vnd.ms-powerpoint';
  return null;
}

function isAllowedChatMediaMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    /^image\/(jpeg|png|gif|webp|heic|heif)$/i.test(m) ||
    /^application\/pdf$/i.test(m) ||
    /^application\/(zip|x-zip-compressed)$/i.test(m) ||
    /^text\/plain$/i.test(m) ||
    /^application\/msword$/i.test(m) ||
    /^application\/vnd\.ms-excel$/i.test(m) ||
    /^application\/vnd\.ms-powerpoint$/i.test(m) ||
    /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$/i.test(
      m,
    )
  );
}
