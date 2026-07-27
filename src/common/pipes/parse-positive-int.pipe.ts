import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isValidNumericId } from '../utils/github.util';

/**
 * Validates a numeric route param (issue / pull-request number) and returns it
 * as a number.
 *
 * Replaces bare `Number(param)` at call sites, which yields NaN for junk input
 * and then interpolates the literal string "NaN" into an upstream GitHub URL.
 */
@Injectable()
export class ParsePositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!isValidNumericId(value)) {
      throw new BadRequestException('Invalid number');
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new BadRequestException('Invalid number');
    }
    return parsed;
  }
}
