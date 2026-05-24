import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { POLICY_SLUG_REGEX } from '@schemas/app-policy.schema';

export class AppPolicySectionDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200_000)
  htmlContent: string;
}

export class UpsertAppPolicyDto {
  @ApiProperty({
    example: 'refund',
    description:
      'Identifiant URL (a-z, chiffres, tirets). Ex. privacy, terms, refund, shipping',
  })
  @IsString()
  @Matches(POLICY_SLUG_REGEX, {
    message:
      'slug must be lowercase letters, digits or hyphens (2–64 chars, start with a letter)',
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

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  description: string;

  @ApiProperty({ type: [AppPolicySectionDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AppPolicySectionDto)
  sections: AppPolicySectionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
