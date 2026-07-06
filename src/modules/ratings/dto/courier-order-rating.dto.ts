import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCourierOrderRatingDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  rate: number;

  /** 1 = poor, 2 = alright, 3 = great */
  @IsNumber()
  @Min(1)
  @Max(3)
  experience: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
