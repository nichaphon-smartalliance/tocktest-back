// A GitHub "owner/repo" slug: each segment is letters, digits, dot, dash or
// underscore. Rejects path-traversal ("../"), query/fragment injection ("?"/"#"),
// whitespace, and anything else that could break out of the intended
// `https://api.github.com/repos/<fullName>` URL path.
export const REPO_FULL_NAME_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function isValidRepoFullName(value: unknown): value is string {
  return typeof value === 'string' && REPO_FULL_NAME_PATTERN.test(value);
}
