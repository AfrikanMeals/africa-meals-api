import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ContactDto {
  @ApiProperty({ example: 'Jean Dupont', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ format: 'email', example: 'jean@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiPropertyOptional({ example: 'Question sur une commande', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiProperty({
    example: 'Bonjour, j’aimerais en savoir plus sur…',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;

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
