import { IsString, MaxLength } from 'class-validator';

// Upper bound guards against oversized payloads (e.g. many base64 images).
// ~10MB of UTF-16 chars, comfortably under the 12MB body limit in main.ts.
const MAX_DOC_LENGTH = 10_000_000;

export class UpdateDocDto {
  @IsString()
  @MaxLength(MAX_DOC_LENGTH, { message: 'Document content is too large.' })
  content: string;
}
