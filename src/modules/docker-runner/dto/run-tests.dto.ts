import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RunTestsDto {
  @IsString()
  @MaxLength(200_000)
  fileContent: string;

  @IsOptional()
  @IsIn(['playwright', 'cypress'])
  framework?: 'playwright' | 'cypress';
}
