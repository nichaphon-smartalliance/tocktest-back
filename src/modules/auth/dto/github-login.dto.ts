import { IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';

export class GithubLoginDto {
  @IsNumber()
  githubId: number;

  @IsString()
  githubLogin: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
