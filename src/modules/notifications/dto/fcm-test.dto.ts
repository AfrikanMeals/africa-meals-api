import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class FcmTestDto {
  @ApiPropertyOptional({
    example: 'Test African Meals',
    description: 'Titre de la notification (défaut si omis)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({
    example: 'Si vous voyez ceci, FCM fonctionne.',
    description: 'Corps du message (défaut si omis)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body?: string;

  @ApiPropertyOptional({
    description:
      'Réservé aux comptes ADMIN : envoyer la notification de test vers un autre utilisateur (ObjectId MongoDB).',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId()
  targetUserId?: string;
}
