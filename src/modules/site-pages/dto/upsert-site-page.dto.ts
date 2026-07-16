import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { SITE_PAGE_SLUG_REGEX } from '@schemas/site-page.schema';

export class UpsertSitePageDto {
  @ApiProperty({
    example: 'vendor',
    description: 'Slug landing marketing (a-z, chiffres, tirets).',
  })
  @IsString()
  @Matches(SITE_PAGE_SLUG_REGEX, {
    message:
      'slug must be lowercase letters, digits or hyphens (start with a letter)',
  })
  slug: string;

  @ApiProperty({ example: 'fr', maxLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  locale: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  metaTitle?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  metaDescription?: string;

  /** Blocs marketing vendor — normalisés côté service. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  content: Record<string, unknown>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
