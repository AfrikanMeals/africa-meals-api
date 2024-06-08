import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { UserModel } from '@schemas/user.schema';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  @InjectModel(UserModel.name)
  private readonly _usersModel: Model<UserModel>;

  @Inject(JwtService)
  private readonly _jwtService: JwtService;

  async register(args: RegisterDto) {
    const { source, ...rest } = args;
    const user = await this._usersModel.findOne({
      [source]: args[source],
    });
    if (user) {
      throw new ConflictException(`user_${source}_conflict`);
    }
    // TODO when registering with FB/GOOGLE, we should check if the user(email/phone) already exists
    const newUser = await this._usersModel.create(rest);

    return this.findUserById(newUser._id.toString());
  }

  async login(args: LoginDto) {
    const { source, ...rest } = args;
    const user = await this._usersModel
      .findOne({
        [source]: args[source],
      })
      .select('+password')
      .exec();

    if (!user) {
      throw new NotFoundException(`user_not_found`);
    }

    if (!(await bcrypt.compare(rest.password, user.password))) {
      throw new NotFoundException(`user_not_found`);
    }

    // TODO add user role(admin, user, etc) claims
    return {
      authToken: this._jwtService.sign({ sub: user._id.toString() }),
    };
  }

  async findUserById(id: string) {
    return this._usersModel.findOne({ _id: id }).exec();
  }

  async findUserByEmail(email: string) {
    return this._usersModel.findOne({ email }).exec();
  }
}
