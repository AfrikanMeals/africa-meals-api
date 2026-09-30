import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PLATFORM_PUSH_CAMPAIGN_AUDIENCES } from '../platform-push-campaign.util';

/** Corps POST /notifications/campaigns — envoi immédiat FCM. */
export class CreatePlatformPushCampaignDto {
  @ApiProperty({
    description: 'Audiences cibles (multi)',
    example: ['CUSTOMER', 'VENDOR'],
    isArray: true,
    enum: PLATFORM_PUSH_CAMPAIGN_AUDIENCES,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn([...PLATFORM_PUSH_CAMPAIGN_AUDIENCES], { each: true })
  audiences: Array<(typeof PLATFORM_PUSH_CAMPAIGN_AUDIENCES)[number]>;

  @ApiProperty({ example: 'Offre du week-end' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Profitez de -20 % sur votre prochaine commande.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body: string;

  @ApiPropertyOptional({
    description: 'URL publique image (mediathèque)',
    example: 'https://cdn.example.com/campaigns/promo.webp',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;
}

/** POST /notifications/campaigns/test — un utilisateur, résultat par jeton. */
export class TestPlatformPushCampaignDto {
  @ApiProperty({
    description: 'E-mail ou id Mongo de l’utilisateur cible',
    example: 'user@example.com',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  target: string;

  @ApiProperty({ example: 'Test iOS' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Message de test campagne' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;
}
