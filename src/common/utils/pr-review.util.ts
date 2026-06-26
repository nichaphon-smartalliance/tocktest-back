export function buildPrReviewInput(pullRequest: any): string {
  return JSON.stringify(
    {
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.state,
      body: pullRequest.body,
      headRef: pullRequest.head?.ref,
      baseRef: pullRequest.base?.ref,
      changedFiles: pullRequest.changed_files,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      files: (pullRequest.files ?? []).slice(0, 15).map((file: any) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch?.slice(0, 1200) ?? null,
      })),
    },
    null,
    2,
  );
}

interface PrReviewResult {
  summary: string;
  riskLevel: string;
  findings: Array<{ file?: string | null; severity?: string; title?: string; comment?: string; suggestion?: string }>;
  mergeRecommendation: string;
}

const RISK_LABEL: Record<string, string> = { low: '[LOW]', medium: '[MEDIUM]', high: '[HIGH]' };
const RECOMMENDATION_LABEL: Record<string, string> = {
  approve: 'Approve',
  comment: 'Comment',
  request_changes: 'Request changes',
};

export function formatPrReviewComment(review: PrReviewResult): string {
  let md = `### TockTest AI PR Review\n\n`;
  md += `**Risk level:** ${RISK_LABEL[review.riskLevel] ?? review.riskLevel}\n`;
  md += `**Recommendation:** ${RECOMMENDATION_LABEL[review.mergeRecommendation] ?? review.mergeRecommendation}\n\n`;
  md += `${review.summary || '_No summary provided._'}\n`;

  if (review.findings?.length) {
    md += `\n#### Findings\n`;
    for (const f of review.findings) {
      md += `\n- **${f.title ?? 'Finding'}**${f.file ? ` (\`${f.file}\`)` : ''} — _${f.severity ?? 'medium'}_\n`;
      if (f.comment) md += `  ${f.comment}\n`;
      if (f.suggestion) md += `  > Suggestion: ${f.suggestion}\n`;
    }
  }

  md += `\n_Generated automatically by TockTest._`;
  return md;
}

export function reviewToCommitStatus(review: PrReviewResult): 'success' | 'failure' | 'pending' {
  if (review.mergeRecommendation === 'approve') return 'success';
  if (review.mergeRecommendation === 'request_changes') return 'failure';
  return 'pending';
}
