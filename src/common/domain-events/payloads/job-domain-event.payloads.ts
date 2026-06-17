import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class JobProgressPayload {
  @IsString()
  @MaxLength(128)
  jobId!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  pct!: number;

  @IsString()
  @MaxLength(256)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  phase?: string;
}

export class JobCompletedPayload {
  @IsString()
  @MaxLength(128)
  jobId!: string;

  @IsOptional()
  result?: Record<string, unknown>;
}

export class JobFailedPayload {
  @IsString()
  @MaxLength(128)
  jobId!: string;

  @IsString()
  @MaxLength(1024)
  error!: string;
}

export type JobDomainEventPayload =
  | JobProgressPayload
  | JobCompletedPayload
  | JobFailedPayload;
