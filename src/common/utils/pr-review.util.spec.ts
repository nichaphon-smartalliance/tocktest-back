import { buildPrReviewInput, formatPrReviewComment, reviewToCommitStatus } from './pr-review.util';

describe('buildPrReviewInput', () => {
  const basePr = {
    number: 42,
    title: 'Fix auth bug',
    state: 'open',
    body: 'Fixes #100',
    head: { ref: 'feature/auth-fix' },
    base: { ref: 'main' },
    changed_files: 3,
    additions: 50,
    deletions: 10,
    files: [],
  };

  it('includes top-level PR fields', () => {
    const parsed = JSON.parse(buildPrReviewInput(basePr));
    expect(parsed.number).toBe(42);
    expect(parsed.title).toBe('Fix auth bug');
    expect(parsed.state).toBe('open');
    expect(parsed.headRef).toBe('feature/auth-fix');
    expect(parsed.baseRef).toBe('main');
  });

  it('caps files at 15 even when PR has more', () => {
    const pr = {
      ...basePr,
      files: Array.from({ length: 20 }, (_, i) => ({
        filename: `file${i}.ts`,
        status: 'modified',
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: 'x',
      })),
    };
    const parsed = JSON.parse(buildPrReviewInput(pr));
    expect(parsed.files).toHaveLength(15);
  });

  it('caps patch at 1200 characters', () => {
    const longPatch = 'x'.repeat(2000);
    const pr = {
      ...basePr,
      files: [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: longPatch }],
    };
    const parsed = JSON.parse(buildPrReviewInput(pr));
    expect(parsed.files[0].patch.length).toBe(1200);
  });

  it('uses null for patch when file has no patch', () => {
    const pr = {
      ...basePr,
      files: [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 }],
    };
    const parsed = JSON.parse(buildPrReviewInput(pr));
    expect(parsed.files[0].patch).toBeNull();
  });

  it('treats missing files as empty array', () => {
    const { files: _f, ...prWithoutFiles } = basePr;
    const parsed = JSON.parse(buildPrReviewInput(prWithoutFiles));
    expect(parsed.files).toEqual([]);
  });
});

describe('formatPrReviewComment', () => {
  const baseReview = {
    summary: 'Looks good.',
    riskLevel: 'low',
    findings: [],
    mergeRecommendation: 'approve',
  };

  it.each([
    ['low', '[LOW]'],
    ['medium', '[MEDIUM]'],
    ['high', '[HIGH]'],
  ])('renders risk label for %s', (riskLevel, label) => {
    const result = formatPrReviewComment({ ...baseReview, riskLevel });
    expect(result).toContain(label);
  });

  it('falls back to the raw riskLevel for unknown values', () => {
    const result = formatPrReviewComment({ ...baseReview, riskLevel: 'critical' });
    expect(result).toContain('critical');
  });

  it.each([
    ['approve', 'Approve'],
    ['comment', 'Comment'],
    ['request_changes', 'Request changes'],
  ])('renders recommendation label for %s', (mergeRecommendation, label) => {
    const result = formatPrReviewComment({ ...baseReview, mergeRecommendation });
    expect(result).toContain(label);
  });

  it('renders summary text', () => {
    const result = formatPrReviewComment({ ...baseReview, summary: 'All clear.' });
    expect(result).toContain('All clear.');
  });

  it('renders fallback when summary is empty', () => {
    const result = formatPrReviewComment({ ...baseReview, summary: '' });
    expect(result).toContain('_No summary provided._');
  });

  it('renders findings section when findings are present', () => {
    const result = formatPrReviewComment({
      ...baseReview,
      findings: [{ title: 'Null check missing', file: 'auth.ts', severity: 'high', comment: 'Check for null.', suggestion: 'Add null guard.' }],
    });
    expect(result).toContain('#### Findings');
    expect(result).toContain('Null check missing');
    expect(result).toContain('`auth.ts`');
    expect(result).toContain('high');
    expect(result).toContain('Check for null.');
    expect(result).toContain('Add null guard.');
  });

  it('omits findings section when findings array is empty', () => {
    const result = formatPrReviewComment(baseReview);
    expect(result).not.toContain('#### Findings');
  });

  it('renders finding without filename when file is null', () => {
    const result = formatPrReviewComment({
      ...baseReview,
      findings: [{ title: 'No file', file: null, severity: 'low' }],
    });
    expect(result).not.toContain('`null`');
  });

  it('always ends with the generated-by line', () => {
    const result = formatPrReviewComment(baseReview);
    expect(result.endsWith('_Generated automatically by TockTest._')).toBe(true);
  });
});

describe('reviewToCommitStatus', () => {
  const base = { summary: '', riskLevel: 'low', findings: [], mergeRecommendation: '' };

  it('returns success for approve', () => {
    expect(reviewToCommitStatus({ ...base, mergeRecommendation: 'approve' })).toBe('success');
  });

  it('returns failure for request_changes', () => {
    expect(reviewToCommitStatus({ ...base, mergeRecommendation: 'request_changes' })).toBe('failure');
  });

  it('returns pending for comment', () => {
    expect(reviewToCommitStatus({ ...base, mergeRecommendation: 'comment' })).toBe('pending');
  });

  it('returns pending for any unknown value', () => {
    expect(reviewToCommitStatus({ ...base, mergeRecommendation: 'other' })).toBe('pending');
  });
});
