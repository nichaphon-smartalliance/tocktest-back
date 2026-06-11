import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateUserSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(100)
  defaultPageSize?: number;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @IsIn(['th', 'en'])
  preferredLanguage?: string;
}
