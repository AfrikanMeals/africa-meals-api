import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class NewsletterSubscribeDto {
  @ApiProperty({ format: 'email', example: 'jean@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiPropertyOptional({ example: 'fr', maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  /** Champ honeypot anti-spam — laisser vide. */
  @ApiPropertyOptional({ description: 'Ne pas remplir (anti-spam)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  /** Token reCAPTCHA Enterprise (côté web). */
  @ApiPropertyOptional({ description: 'Token reCAPTCHA Enterprise' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  recaptchaToken?: string;
}
