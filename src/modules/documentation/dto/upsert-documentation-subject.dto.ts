import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertDocumentationSubjectDto {
  @ApiProperty({ example: 'reset-password' })
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

  @ApiProperty({ example: 'account' })
  @IsString()
  @MaxLength(64)
  topicSlug: string;

  @ApiProperty({ example: 'Réinitialiser mon mot de passe' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'Étapes pour récupérer l’accès.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @ApiPropertyOptional({ example: '<p>Contenu HTML…</p>' })
  @IsOptional()
  @IsString()
  htmlContent?: string;

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
