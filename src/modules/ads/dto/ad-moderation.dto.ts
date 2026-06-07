import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectAdModerationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  rejectionReason: string;
}

export class ListAdModerationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
