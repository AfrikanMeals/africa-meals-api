import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const BUSINESS_REPORT_EMAIL_RECIPIENTS = ['vendor', 'customer'] as const;
export type BusinessReportEmailRecipient =
  (typeof BUSINESS_REPORT_EMAIL_RECIPIENTS)[number];

export class SendBusinessReportEmailDto {
  @ApiProperty({ enum: BUSINESS_REPORT_EMAIL_RECIPIENTS })
  @IsIn(BUSINESS_REPORT_EMAIL_RECIPIENTS)
  recipient: BusinessReportEmailRecipient;

  @ApiProperty({ description: 'Corps du message (texte brut)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;

  @ApiPropertyOptional({ description: 'Objet de l’e-mail', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;
}
