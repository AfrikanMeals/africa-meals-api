import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';

export class InternalChatPushDto {
  @ApiProperty({
    type: [String],
    description: 'Destinataires (autres que l’expéditeur)',
  })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  storeName?: string;

  @ApiPropertyOptional({
    description: 'Id commande (chat livraison ORDER) — deep-link mobile',
  })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({
    description: 'Contexte conversation WS : ORDER | DIRECT | …',
  })
  @IsOptional()
  @IsString()
  contextType?: string;
}
