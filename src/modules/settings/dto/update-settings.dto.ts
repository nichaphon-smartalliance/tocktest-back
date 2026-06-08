import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  defaultBranch?: string;

  @IsOptional()
  @IsBoolean()
  autoAnalyzeOnPush?: boolean;

  @IsOptional()
  @IsString()
  aiProvider?: string;

  @IsOptional()
  @IsString()
  aiModel?: string;
}
