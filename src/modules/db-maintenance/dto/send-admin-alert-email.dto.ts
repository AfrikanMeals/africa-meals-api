import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export enum AdminAlertAudience {
  ALL_VENDORS = 'all_vendors',
  ALL_DELIVERY_AGENTS = 'all_delivery_agents',
  ALL_CUSTOMERS = 'all_customers',
  CUSTOM = 'custom',
}

export class SendAdminAlertEmailDto {
  @IsEnum(AdminAlertAudience)
  audience: AdminAlertAudience;

  @ValidateIf((o: SendAdminAlertEmailDto) => o.audience === AdminAlertAudience.CUSTOM)
  @IsString()
  @IsNotEmpty()
  customEmails?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500_000)
  htmlBody: string;
}

export class AdminAlertAudienceQueryDto {
  @IsEnum(AdminAlertAudience)
  audience: AdminAlertAudience;

  @ValidateIf((o: AdminAlertAudienceQueryDto) => o.audience === AdminAlertAudience.CUSTOM)
  @IsOptional()
  @IsString()
  customEmails?: string;
}
