import { IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';

export class CreateBaselineDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(2000)
  url: string;

  @IsString()
  screenshotData: string; // base64 PNG

  @IsOptional()
  @IsString()
  viewport?: string;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;
}

export class CompareDto {
  @IsString()
  baselineId: string;

  @IsString()
  screenshotData: string; // base64 PNG candidate

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  threshold?: number;
}
