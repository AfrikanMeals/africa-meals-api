import { IsNotEmpty, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CreateRatingDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(5)
  rate: number;

  @IsOptional()
  @IsNotEmpty()
  comment?: string;
}
