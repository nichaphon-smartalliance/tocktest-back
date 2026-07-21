import { ArrayMaxSize, IsUUID, IsOptional, IsString, IsArray, MaxLength, Matches } from 'class-validator';

export class GenerateTestCasesDto {
  @IsUUID()
  repoId: string;

  // ISO date strings only — bounds length and rejects free-form garbage before
  // it's passed through to the GitHub `since`/`until` query params.
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/)
  fromDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/)
  toDate?: string;

  // Only the first 5 are ever used (ai.service.ts fetchCommitDiffs), but the
  // full array is validated first — cap it so an oversized array can't be
  // used to burn CPU/GitHub-API-fanout before that slice happens.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[0-9a-f]{7,40}$/, { each: true })
  commitShas?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  branch?: string;
}
