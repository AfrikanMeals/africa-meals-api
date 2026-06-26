import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class TriggerMigrationDto {
  @ApiPropertyOptional({
    description: 'URI MongoDB complète de la base cible (prioritaire).',
  })
  @IsOptional()
  @IsString()
  uri?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  host?: string;

  @ApiPropertyOptional({ default: 27017 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  database?: string;

  @ApiPropertyOptional({ default: 'admin' })
  @IsOptional()
  @IsString()
  authSource?: string;

  @ApiPropertyOptional({
    description: 'Vider chaque collection cible avant copie.',
  })
  @IsOptional()
  @IsBoolean()
  dropTargetCollections?: boolean;

  @ApiProperty({
    description: 'Phrase de confirmation : MIGRER_AFRIKAMEALS',
  })
  @IsString()
  @IsNotEmpty()
  confirmPhrase: string;
}
