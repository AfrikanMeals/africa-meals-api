import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { memoryStorage } from 'multer';
import { AuthService } from './auth.service';
import {
  CheckAccountDto,
  EmailVerificationDto,
  ForgotPasswordDto,
  GoogleAuthDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { JwtGuard } from './guards/jwt.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  @Inject(AuthService)
  private readonly _authService: AuthService;

  @Post('register')
  async register(@Body(ValidationPipe) args: RegisterDto) {
    this.logger.log(
      `[POST /auth/register] corps validé email=${args.email} fullName=${args.fullName} source=${args.source} signupRole=${args.signupRole ?? '—'}`,
    );
    return this._authService.register(args);
  }

  /** Étape 1 : envoi du code — pas encore de ligne dans `users` (sauf mode sans SMTP / compte test). */
  @Post('register/start')
  async registerStart(@Body(ValidationPipe) args: RegisterDto) {
    this.logger.log(
      `[POST /auth/register/start] email=${args.email} fullName=${args.fullName}`,
    );
    return this._authService.registerStart(args);
  }

  /** Étape 2 : validation du code et création du compte. */
  @Post('register/complete')
  async registerComplete(@Body(ValidationPipe) args: EmailVerificationDto) {
    return this._authService.registerComplete(args);
  }

  @Post('register/resend-code')
  async resendPendingSignup(@Body(ValidationPipe) args: ForgotPasswordDto) {
    return this._authService.resendPendingSignupCode(args.email);
  }

  @Post('login')
  async login(@Body(ValidationPipe) args: LoginDto) {
    this.logger.log(`login body: ${JSON.stringify(args)}`);
    return this._authService.login(args);
  }

  @Post('google')
  async authWithGoogle(@Body(ValidationPipe) args: GoogleAuthDto) {
    this.logger.log(`google body: ${JSON.stringify(args)}`);
    return this._authService.authWithGoogle(args);
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
    return req.user as UserModel;
  }

  @Delete('me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async deleteAccount(@Req() req: Request) {
    const user = req.user as UserModel;
    return this._authService.deleteAccount(user._id.toString());
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

  @Post('me/chat-voice')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024, files: 1 },
      fileFilter: (req, file, cb) => {
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

  @Post('me/chat-media')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
      fileFilter: (req, file, cb) => {
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
