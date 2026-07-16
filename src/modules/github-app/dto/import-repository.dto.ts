import { Matches } from 'class-validator';
import { REPO_FULL_NAME_PATTERN } from '../../../common/utils/github.util';

export class ImportRepositoryDto {
  @Matches(REPO_FULL_NAME_PATTERN, { message: 'fullName must be in "owner/repo" format' })
  fullName: string;
}
