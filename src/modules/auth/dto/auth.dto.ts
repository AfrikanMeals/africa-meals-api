import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CheckAccountDto {
  @ApiProperty({ enum: ['email'], example: 'email' })
  @IsNotEmpty()
  @Trim()
  @IsEnum(['email'])
  source: 'email' | 'phoneNumber' | 'googleId' | 'Idfacebook';

  @ApiPropertyOptional({ format: 'email', example: 'user@example.com' })
  @IsNotEmpty()
  @IsEmail()
  @Trim()
  @ValidateIf((o) => o.registrationSource === 'email')
  email: string;

  @ApiPropertyOptional({
    format: 'tel',
    example: '+14165551234',
    description: 'Numéro canadien',
  })
  @IsNotEmpty()
  @Trim()
  @IsPhoneNumber('CN', {
    message: 'Please enter a valid Canadian phone number.',
  })
  @ValidateIf((o) => o.registrationSource === 'phone')
  phoneNumber: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @Trim()
  @ValidateIf((o) => o.registrationSource === 'facebookId')
  facebookId?: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @Trim()
  @ValidateIf((o) => o.registrationSource === 'googleId')
  googleId?: string;
}

export class LoginDto extends CheckAccountDto {
  @ApiProperty({ minLength: 6, example: 'secret123', format: 'password' })
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class RegisterDto extends LoginDto {
  @ApiProperty({ example: 'Jean Dupont' })
  @IsNotEmpty()
  @Trim()
  fullName: string;

  /** Valeurs alignées sur le sélecteur du Dashboard (signup) */
  @IsOptional()
  @IsIn(['restaurant', 'livreur', 'client'])
  signupRole?: 'restaurant' | 'livreur' | 'client';
}

export class EmailVerificationDto {
  @ApiProperty({ format: 'email', example: 'user@example.com' })
  @IsNotEmpty()
  @Trim()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456', description: 'Code reçu par email' })
  @IsNotEmpty()
  @Trim()
  code: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ format: 'email', example: 'user@example.com' })
  @IsNotEmpty()
  @Trim()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ format: 'email', example: 'user@example.com' })
  @IsNotEmpty()
  @Trim()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'ABC12XYZ', description: 'Code reçu par email' })
  @IsNotEmpty()
  @Trim()
  code: string;

  @ApiProperty({ minLength: 6, example: 'newSecret123', format: 'password' })
  @IsNotEmpty()
  @Trim()
  @MinLength(6)
  password: string;
}

/** Mise à jour du profil utilisateur (données personnelles) */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jean Dupont' })
  @IsOptional()
  @Trim()
  fullName?: string;

  @ApiPropertyOptional({ example: '+237651796157' })
  @IsOptional()
  @Trim()
  phoneNumber?: string;

  @ApiPropertyOptional({
    description: 'Pays d’utilisation de l’app (ISO2, ex. CA, SN)',
    example: 'CA',
  })
  @IsOptional()
  @Trim()
  @Matches(/^[A-Z]{2}$/i, { message: 'Code pays ISO2 requis' })
  appCountryCode?: string;
}

/** Données reçues après Google Sign-In (création ou connexion de compte) */
/**
 * Vocal chat : JSON + base64 — fiable quand multipart échoue (Firebase / CF / proxys).
 * @see StoreProfileImageJsonDto
 */
export class ChatVoiceJsonDto {
  @ApiProperty({
    description: 'Audio en base64 (pur ou préfixe data:audio/...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  audioBase64: string;

  @ApiPropertyOptional({ example: 'recording.webm' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ example: 'audio/webm' })
  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class GoogleAuthDto {
  @ApiProperty({ description: 'ID Google du compte' })
  @IsNotEmpty()
  @Trim()
  googleId: string;

  @ApiProperty({ format: 'email', example: 'user@gmail.com' })
  @IsNotEmpty()
  @Trim()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Jean Dupont', description: 'Nom affiché Google' })
  @IsNotEmpty()
  @Trim()
  fullName: string;
}
