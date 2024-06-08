import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  CheckAccountDto,
  EmailVerificationDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { JwtGuard } from './guards/jwt.guard';

@Controller('auth')
export class AuthController {
  @Inject(AuthService)
  private readonly _authService: AuthService;

  @Post('register')
  async register(@Body(ValidationPipe) args: RegisterDto) {
    return this._authService.register(args);
  }

  @Post('login')
  async login(@Body(ValidationPipe) args: LoginDto) {
    return this._authService.login(args);
  }

  @Post('verify-email')
  async verifyEmail(@Body(ValidationPipe) args: EmailVerificationDto) {
    return this._authService.verifyEmail(args);
  }

  @Post('resend-verification-code')
  async resendVerificationCode(@Body('email', ValidationPipe) email: string) {
    return this._authService.resendVerificationCode(email);
  }

  @Post('reset-password')
  async resetPassword(@Body(ValidationPipe) args: ResetPasswordDto) {
    return this._authService.resetPassword(args);
  }

  @Post('check-account')
  async checkAccount(@Body(ValidationPipe) args: CheckAccountDto) {
    return this._authService.checkAccount(args);
  }

  @Get('me')
  @UseGuards(JwtGuard)
  async getMe(@Req() req: Request) {
    return req.user as UserModel;
  }
}
