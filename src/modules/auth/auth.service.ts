import { MailerService } from '@modules/mailer/mailer.service';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { UserModel } from '@schemas/user.schema';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import {
  CheckAccountDto,
  EmailVerificationDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  @InjectModel(UserModel.name)
  private readonly _usersModel: Model<UserModel>;

  @Inject(JwtService)
  private readonly _jwtService: JwtService;

  @Inject(MailerService)
  private readonly _mailer: MailerService;

  @Inject(ConfigService)
  private readonly _configService: ConfigService;

  async register(args: RegisterDto) {
    const { source, ...rest } = args;
    const user = await this._usersModel.findOne({
      [source]: args[source],
    });
    if (user) {
      throw new ConflictException(`user_${source}_conflict`);
    }

    const activationCode = await this._generateVerificationCode(6);
    const isTestAccount =
      source === 'email' && rest.email && rest.email.includes('test');

    // TODO when registering with FB/GOOGLE, we should check if the user(email/phone) already exists
    const newUser = await this._usersModel.create({
      ...rest,
      ...(isTestAccount && { emailVerifiedAt: new Date() }),
      ...(!isTestAccount && { activationCode }),
    });

    await this._mailer.send({
      to: args.email,
      subject: 'Bienvenue sur ' + this._configService.get<string>('APP_NAME'),
      templateId: this._configService.get<string>(
        'ACCOUNT_VERIFICATION_TEMPLATE_ID',
      ),
      context: {
        name: args.fullName,
        code: await this._generateVerificationCode(6),
      },
    });

    return this.findUserById(newUser._id.toString());
  }

  async login(args: LoginDto) {
    const { source, ...rest } = args;
    const user = await this._usersModel
      .findOne({
        [source]: args[source],
      })
      .select(['+password', '+emailVerifiedAt'])
      .exec();

    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }

    if (!(await bcrypt.compare(rest.password, user.password))) {
      throw new NotFoundException(`user_not_found`);
    }

    // TODO adjust verification based on source. For now, we only verify email

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(`email_not_verified`);
    }

    // TODO add user role(admin, user, etc) claims
    return {
      authToken: this._jwtService.sign({ sub: user._id.toString() }),
    };
  }

  async checkAccount(args: CheckAccountDto) {
    const user = await this._usersModel
      .findOne({ [args.source]: args[args.source] })
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    return user;
  }

  async verifyEmail({ code: activationCode, email }: EmailVerificationDto) {
    const user = await this._usersModel
      .findOneAndUpdate(
        { activationCode, email, emailVerifiedAt: null },
        { activationCode: null, emailVerifiedAt: new Date() },
        { new: true },
      )
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    return user;
  }

  async resendVerificationCode(email: string) {
    const code = await this._generateVerificationCode(6);
    const user = await this._usersModel
      .findOneAndUpdate(
        { email },
        {
          emailVerifiedAt: null,
          activationCode: code,
        },
        { new: true },
      )
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    await this._mailer.send({
      to: email,
      subject: 'Bienvenue sur ' + this._configService.get<string>('APP_NAME'),
      templateId: this._configService.get<string>(
        'ACCOUNT_VERIFICATION_TEMPLATE_ID',
      ),
      context: {
        name: user.fullName,
        code,
      },
    });
    return user;
  }

  async resetPassword({ email, password }: ResetPasswordDto) {
    const user = await this._usersModel
      .findOneAndUpdate({ email }, { password }, { new: true })
      .exec();
    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }
    return user;
  }

  async findUserById(id: string) {
    return this._usersModel
      .findOne({ _id: id })
      .populate('addresses')
      .populate('stores')
      .populate('paymentMethods')
      .exec();
  }

  async findUserByEmail(email: string) {
    return this._usersModel.findOne({ email }).exec();
  }

  private async _generateVerificationCode(length: number) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }
}
