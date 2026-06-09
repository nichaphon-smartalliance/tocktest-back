import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsIn,
  IsBoolean,
} from 'class-validator';

const TEST_TYPES = ['manual', 'automated', 'ui', 'api', 'integration'] as const;
const TEST_STATUSES = ['pass', 'fail', 'blocked', 'not_tested'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export class CreateTestCaseDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  steps?: { order: number; description: string }[];

  @IsOptional()
  @IsString()
  expectedResult?: string;

  @IsOptional()
  @IsIn(TEST_TYPES)
  testType?: string;

  @IsOptional()
  @IsIn(TEST_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isAiGenerated?: boolean;

  @IsOptional()
  aiGenerationMetadata?: Record<string, unknown>;
}

export class UpdateTestCaseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  steps?: { order: number; description: string }[];

  @IsOptional()
  @IsString()
  expectedResult?: string;

  @IsOptional()
  @IsIn(TEST_TYPES)
  testType?: string;

  @IsOptional()
  @IsIn(TEST_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isAiGenerated?: boolean;

  @IsOptional()
  aiGenerationMetadata?: Record<string, unknown>;
}

export class BulkSaveTestCasesDto {
  @IsArray()
  testCases: CreateTestCaseDto[];
}
