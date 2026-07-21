import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @IsString()
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(8000)
  content: string;
}

export class ChatRequestDto {
  @IsString()
  @MaxLength(8000)
  message: string;

  // Only the last 8 entries are ever used (chatbot.service.ts), but validation
  // runs on the full array first — cap it so an oversized array can't be used
  // to burn CPU on nested validation before that slice happens.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @IsOptional()
  @IsString()
  @IsIn(['th', 'en'])
  language?: 'th' | 'en';
}
