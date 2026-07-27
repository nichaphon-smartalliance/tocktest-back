// A GitHub "owner/repo" slug: each segment is letters, digits, dot, dash or
// underscore. Rejects path-traversal ("../"), query/fragment injection ("?"/"#"),
// whitespace, and anything else that could break out of the intended
// `https://api.github.com/repos/<fullName>` URL path.
export const REPO_FULL_NAME_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function isValidRepoFullName(value: unknown): value is string {
  return typeof value === 'string' && REPO_FULL_NAME_PATTERN.test(value);
}

// A git object id: 7-40 lowercase/uppercase hex chars. Anything interpolated into
// a `.../commits/<sha>` or `.../statuses/<sha>` URL path must match this, otherwise
// "../" segments let a caller climb out of the repo scope and hit an arbitrary
// GitHub API endpoint with the victim's token (see git.util.spec).
export const COMMIT_SHA_PATTERN = /^[0-9a-fA-F]{7,40}$/;

export function isValidCommitSha(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_SHA_PATTERN.test(value);
}

// A git ref (branch/tag) as accepted in a compare range. Deliberately narrower
// than git's own rules — no "..", no path/query/fragment metacharacters.
export const GIT_REF_PATTERN = /^[A-Za-z0-9._\-/]+$/;

export function isValidGitRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    GIT_REF_PATTERN.test(value) &&
    !value.includes('..')
  );
}

// GitHub numeric ids (installation ids, issue/PR numbers) arrive as strings from
// path params and query strings. They land in URL paths, so constrain them to
// digits rather than trusting Number() coercion (which silently yields NaN).
export const NUMERIC_ID_PATTERN = /^[0-9]{1,20}$/;

export function isValidNumericId(value: unknown): value is string {
  return typeof value === 'string' && NUMERIC_ID_PATTERN.test(value);
}

/**
 * Percent-encodes each segment of a repository file path so that a path from the
 * git tree (which may legitimately contain `?`, `#` or spaces) cannot inject a
 * query string, fragment, or extra path segment into the contents API URL.
 */
export function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
