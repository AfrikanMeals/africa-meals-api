import {
  IsBoolean,
  IsMongoId,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PostSupportChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  text: string;
}

export class PostSupportChatSatisfactionDto {
  @IsMongoId()
  promptMessageId: string;

  @IsBoolean()
  satisfied: boolean;
}
