import { IsUUID, IsOptional, IsString, IsArray } from 'class-validator';

export class GenerateTestCasesDto {
  @IsUUID()
  repoId: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  commitShas?: string[];
}
