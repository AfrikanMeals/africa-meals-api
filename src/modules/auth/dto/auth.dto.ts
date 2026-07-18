import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Enregistrement d’un jeton FCM (app mobile ou admin web). */
export class RegisterFcmTokenDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiProperty({ enum: ['android', 'ios', 'web'] })
  @IsIn(['android', 'ios', 'web'])
  platform: 'android' | 'ios' | 'web';
}

export class RemoveFcmTokenDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  token: string;
}

export class CheckAccountDto {
  @ApiProperty({ enum: ['email', 'phoneNumber'], example: 'email' })
  @IsNotEmpty()
  @Trim()
  @IsIn(['email', 'phoneNumber'])
  source: 'email' | 'phoneNumber' | 'googleId' | 'Idfacebook';

  @ApiPropertyOptional({ format: 'email', example: 'user@example.com' })
  @ValidateIf((o) => o.source === 'email')
  @IsNotEmpty()
  @IsEmail()
  @Trim()
  email?: string;

  @ApiPropertyOptional({
    format: 'tel',
    example: '+14165551234',
    description: 'Numéro canadien',
  })
  @ValidateIf((o) => o.source === 'phoneNumber')
  @IsNotEmpty()
  @Trim()
  @IsPhoneNumber('CN', {
    message: 'Please enter a valid Canadian phone number.',
  })
  phoneNumber?: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.source === 'facebookId')
  @IsNotEmpty()
  @Trim()
  facebookId?: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.source === 'googleId')
  @IsNotEmpty()
  @Trim()
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

/** Changement de mot de passe (compte e-mail / mot de passe). */
export class ChangePasswordDto {
  @ApiProperty({ format: 'password', minLength: 6 })
  @IsNotEmpty()
  @MinLength(6)
  currentPassword: string;

  @ApiProperty({ format: 'password', minLength: 6 })
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}

/** Confirmation activation 2FA par e-mail. */
export class Email2faConfirmDto {
  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @Trim()
  code: string;
}

/** Validation 2FA après login / OAuth (étape 2). */
export class Verify2faLoginDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  challengeToken: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @Trim()
  code: string;
}

/** Renvoi du code 2FA de connexion. */
export class Resend2faLoginDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  challengeToken: string;
}

/** Résolution d’un lien OTP opaque (H-10). */
export class ResolveOtpLinkDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Trim()
  token: string;
}

/** Mise à jour du profil utilisateur (données personnelles) */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jean Dupont' })
  @IsOptional()
  @Trim()
  fullName?: string;

  /**
   * Username unique (optionnel). Vide = effacer.
   * Format strict validé aussi côté service après normalisation.
   */
  @ApiPropertyOptional({
    example: 'jean_dupont',
    description:
      'Identifiant unique (3–30, lettre puis a-z0-9_). Chaîne vide pour effacer.',
  })
  @IsOptional()
  @IsString()
  @Trim()
  @MaxLength(30)
  username?: string;

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

/** Image / pièce jointe chat : JSON + base64 — aligné sur [ChatVoiceJsonDto]. */
export class ChatMediaJsonDto {
  @ApiProperty({
    description: 'Fichier en base64 (pur ou préfixe data:...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  fileBase64: string;

  @ApiProperty({ example: 'photo.jpg' })
  @IsNotEmpty()
  @IsString()
  filename: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mimeType?: string;
}

/**
 * Photo de profil utilisateur : JSON + base64.
 * Fastify / Firebase / proxys rejettent souvent multipart (415 Unsupported Media Type).
 * @see StoreProfileImageJsonDto
 */
export class ProfileImageJsonDto {
  @ApiProperty({
    description: 'Image en base64 (pur ou préfixe data:image/...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @ApiPropertyOptional({ example: 'photo.jpg' })
  @IsOptional()
  @IsString()
  filename?: string;
}

/** Jeton Firebase ID (utilisateur connecté via Google dans Firebase Auth), vérifié côté serveur. */
export class GoogleAuthDto {
  @ApiProperty({
    description:
      'ID token JWT émis par Firebase après connexion Google (Firebase Auth).',
    example: 'eyJhbGciOiJSUzI1NiIs...',
  })
  @IsNotEmpty()
  @Trim()
  @IsString()
  idToken: string;
}

/** Jeton Firebase ID (utilisateur connecté via Apple dans Firebase Auth), vérifié côté serveur. */
export class AppleAuthDto {
  @ApiProperty({
    description:
      'ID token JWT émis par Firebase après connexion Apple (Firebase Auth).',
    example: 'eyJhbGciOiJSUzI1NiIs...',
  })
  @IsNotEmpty()
  @Trim()
  @IsString()
  idToken: string;
}

/** Jeton Firebase ID (utilisateur connecté via Facebook dans Firebase Auth), vérifié côté serveur. */
export class FacebookAuthDto {
  @ApiProperty({
    description:
      'ID token JWT émis par Firebase après connexion Facebook (Firebase Auth).',
    example: 'eyJhbGciOiJSUzI1NiIs...',
  })
  @IsNotEmpty()
  @Trim()
  @IsString()
  idToken: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token JWT émis par /auth/login ou /auth/refresh.',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsNotEmpty()
  @Trim()
  @IsString()
  refreshToken: string;
}
