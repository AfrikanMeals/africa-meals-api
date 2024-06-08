import { Trim } from 'class-sanitizer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsPhoneNumber,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @IsNotEmpty()
  @Trim()
  @IsEnum(['email', 'phoneNumber', 'googleId', 'facebookId'])
  source: 'email' | 'phoneNumber' | 'googleId' | 'Idfacebook';

  @IsNotEmpty()
  @IsEmail()
  @Trim()
  @ValidateIf((o) => o.registrationSource === 'email')
  email: string;

  @IsNotEmpty()
  @Trim()
  @IsPhoneNumber('CN', {
    message: 'Please enter a valid Canadian phone number.',
  }) // TODO Restricted to Canada for now
  @ValidateIf((o) => o.registrationSource === 'phone')
  phoneNumber: string;

  @IsNotEmpty()
  @Trim()
  @ValidateIf((o) => o.registrationSource === 'facebookId')
  facebookId?: string;

  @IsNotEmpty()
  @Trim()
  @ValidateIf((o) => o.registrationSource === 'googleId')
  googleId?: string;

  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class RegisterDto extends LoginDto {
  @IsNotEmpty()
  @Trim()
  fullName: string;
}
