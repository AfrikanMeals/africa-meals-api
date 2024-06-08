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
import { LoginDto, RegisterDto } from './dto/auth.dto';
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

  @Get('me')
  @UseGuards(JwtGuard)
  async getMe(@Req() req: Request) {
    return req.user as UserModel;
  }
}
