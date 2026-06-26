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

  /** Index courant (ex. collection 3/12). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  current?: number;

  /** Total d’étapes (ex. nombre de collections). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number;

  /** Documents copiés / traités cumulés. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  documentsCopied?: number;
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
