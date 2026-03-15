import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  CheckAccountDto,
  EmailVerificationDto,
  ForgotPasswordDto,
  GoogleAuthDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
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
    this.logger.log(`register body: ${JSON.stringify(args)}`);
    return this._authService.register(args);
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
    this.logger.log(`forgot-password body: ${JSON.stringify(args)}`);
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

  @Get('me')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtGuard)
  async getMe(@Req() req: Request) {
    return req.user as UserModel;
  }
}
