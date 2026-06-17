import { IsString, MinLength } from 'class-validator';

export class GithubLoginDto {
  @IsString()
  @MinLength(20)
  accessToken: string;
}
