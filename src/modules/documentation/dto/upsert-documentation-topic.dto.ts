import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertDocumentationTopicDto {
  @ApiProperty({ example: 'account' })
  @IsString()
  @MaxLength(64)
  slug: string;

  @ApiPropertyOptional({ example: 'fr' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;

  @ApiProperty({ example: 'restaurants' })
  @IsString()
  @MaxLength(64)
  groupSlug: string;

  @ApiProperty({ example: 'Compte' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'Profil, connexion et paramètres.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @ApiPropertyOptional({ example: 'hgi-user-circle' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  icon?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
