import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { APP_POLICY_SLUGS } from '@schemas/app-policy.schema';

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
  @ApiProperty({ enum: APP_POLICY_SLUGS })
  @IsString()
  @IsIn([...APP_POLICY_SLUGS])
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
