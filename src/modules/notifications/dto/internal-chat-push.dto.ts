import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';

export class InternalChatPushDto {
  @ApiProperty({ type: [String], description: 'Destinataires (autres que l’expéditeur)' })
  @IsArray()
  @IsMongoId({ each: true })
  recipientUserIds: string[];

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  body: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conversationId?: string;
}
