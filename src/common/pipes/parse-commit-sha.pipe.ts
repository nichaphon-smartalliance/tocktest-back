import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isValidCommitSha } from '../utils/github.util';

/**
 * Validates a `:sha` route param as a git object id.
 *
 * Express percent-decodes path params, so `..%2F..%2Fuser` arrives here as
 * `../../user`. Without this the value flows into a GitHub API URL path and
 * escapes the intended `/repos/<owner>/<repo>/commits/` scope. Rejecting at the
 * edge turns that into a clean 400 instead of an unintended upstream request.
 */
@Injectable()
export class ParseCommitShaPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isValidCommitSha(value)) {
      throw new BadRequestException('Invalid commit SHA');
    }
    return value;
  }
}
