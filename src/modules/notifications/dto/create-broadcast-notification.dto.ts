import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBroadcastNotificationDto {
  @ApiProperty({ example: 'Nouveauté African Meals' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Découvrez les plats de la semaine.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({ example: 'marketing' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @ApiPropertyOptional({
    description:
      'Payload JSON stocké avec la notification (clés string recommandées côté mobile).',
    example: { screen: 'home' },
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Si true, envoie en plus une notification push FCM à tous les utilisateurs ayant au moins un jeton.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  sendPush?: boolean;
}
