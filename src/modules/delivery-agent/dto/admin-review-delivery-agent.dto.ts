import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectDeliveryAgentApplicationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  rejectionReason: string;
}

export class SuspendDeliveryAgentApplicationDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  suspensionReason?: string;
}

export class ListDeliveryAgentApplicationsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
