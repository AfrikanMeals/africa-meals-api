import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsMongoId } from 'class-validator';

export class MarkNotificationsReadDto {
  @ApiProperty({
    description: 'Identifiants des notifications à marquer comme lues',
    type: [String],
    example: ['507f1f77bcf86cd799439011'],
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  notificationIds: string[];
}
