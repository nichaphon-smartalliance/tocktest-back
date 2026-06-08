import { IsString, MinLength } from 'class-validator';

export class CreateGithubTokenDto {
  @IsString()
  label: string;

  @IsString()
  @MinLength(10)
  token: string;
}
