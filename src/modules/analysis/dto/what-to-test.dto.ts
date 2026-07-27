import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, Matches } from 'class-validator';
import { COMMIT_SHA_PATTERN } from '../../../common/utils/github.util';

export class WhatToTestDto {
  // Each sha is interpolated into a GitHub API URL path, so it must be a plain
  // hex object id — "../" here would climb out of the repo scope. Capped as well
  // so an oversized array can't fan out into a burst of GitHub requests
  // (analysis.service only ever fetches the first 10 missing shas).
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(COMMIT_SHA_PATTERN, { each: true, message: 'commitShas must be hex commit SHAs' })
  commitShas: string[];
}
