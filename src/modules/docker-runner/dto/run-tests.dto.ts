import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RunTestsDto {
  @IsString()
  @MaxLength(200_000)
  fileContent: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  framework?: 'cypress';
}
