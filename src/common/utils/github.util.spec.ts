import { isValidRepoFullName } from './github.util';

describe('isValidRepoFullName', () => {
  it.each(['owner/repo', 'my-org/my.repo', 'a_b/c-d', 'User123/Repo_456'])(
    'accepts valid owner/repo slug: %s',
    (value) => {
      expect(isValidRepoFullName(value)).toBe(true);
    },
  );

  it.each([
    'owner/repo/../../orgs/secret',   // path traversal
    '../etc/passwd',
    'owner/repo?ref=main',            // query injection
    'owner/repo#frag',                // fragment injection
    'owner/repo extra',               // whitespace
    'owner//repo',                    // empty segment
    'owner',                          // missing repo
    'owner/repo/extra',               // too many segments
    'owner/re po',                    // space in segment
    '',                               // empty
    'owner/repo\n',                   // newline
  ])('rejects malicious or malformed input: %j', (value) => {
    expect(isValidRepoFullName(value)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidRepoFullName(undefined)).toBe(false);
    expect(isValidRepoFullName(null)).toBe(false);
    expect(isValidRepoFullName(123)).toBe(false);
    expect(isValidRepoFullName({ toString: () => 'owner/repo' })).toBe(false);
  });
});
