import { IsString } from 'class-validator';

export class UpdateDocDto {
  @IsString()
  content: string;
}
