import { heuristicAnalyzeCommit, heuristicGenerateTestCases, heuristicWhatToTest, heuristicChat } from './heuristic-ai';

// ── heuristicAnalyzeCommit ────────────────────────────────────────────────────

describe('heuristicAnalyzeCommit', () => {
  function makeCommit(files: number, additions: number, deletions: number, message?: string) {
    return JSON.stringify({ stats: { total: files, additions, deletions }, message });
  }

  it('returns low risk for small churn (< 50)', () => {
    const result = heuristicAnalyzeCommit(makeCommit(2, 10, 5));
    expect(result.riskLevel).toBe('low');
  });

  it('returns medium risk for churn 50–299', () => {
    const result = heuristicAnalyzeCommit(makeCommit(2, 150, 100));
    expect(result.riskLevel).toBe('medium');
  });

  it('returns high risk for churn 300–999', () => {
    const result = heuristicAnalyzeCommit(makeCommit(3, 500, 100));
    expect(result.riskLevel).toBe('high');
  });

  it('returns critical risk for churn >= 1000', () => {
    const result = heuristicAnalyzeCommit(makeCommit(5, 800, 300));
    expect(result.riskLevel).toBe('critical');
  });

  it('upgrades risk by one level when files > 10', () => {
    // 40 churn alone = low, but 11 files bumps to medium
    const result = heuristicAnalyzeCommit(makeCommit(11, 25, 15));
    expect(result.riskLevel).toBe('medium');
  });

  it('does not upgrade critical beyond critical', () => {
    const result = heuristicAnalyzeCommit(makeCommit(11, 800, 300));
    expect(result.riskLevel).toBe('critical');
  });

  it('includes the commit message in the summary (sliced to 80 chars)', () => {
    const msg = 'Fix auth issue in login service';
    const result = heuristicAnalyzeCommit(makeCommit(1, 5, 5, msg));
    expect(result.summary).toContain(msg.slice(0, 80));
  });

  it('does not throw on invalid JSON input', () => {
    const result = heuristicAnalyzeCommit('not json at all');
    expect(result.source).toBe('heuristic');
    expect(result.riskLevel).toBeDefined();
  });

  it('always returns the required shape', () => {
    const result = heuristicAnalyzeCommit(makeCommit(1, 1, 1));
    expect(result).toMatchObject({
      summary: expect.any(String),
      riskLevel: expect.any(String),
      testSuggestions: expect.arrayContaining([expect.any(String)]),
      affectedAreas: expect.any(Array),
      source: 'heuristic',
    });
    expect(result.testSuggestions).toHaveLength(2);
  });
});

// ── heuristicGenerateTestCases ────────────────────────────────────────────────

describe('heuristicGenerateTestCases', () => {
  const diffWithFiles = `--- Commit abc1234 ---
diff --git a/src/auth.ts b/src/auth.ts
index 000..111 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/user.ts b/src/user.ts
index 000..111 100644`;

  it('returns one entry per changed file', () => {
    const result = heuristicGenerateTestCases(diffWithFiles);
    expect(result).toHaveLength(2);
  });

  it('first entry has priority high, rest have medium', () => {
    const result = heuristicGenerateTestCases(diffWithFiles);
    expect(result[0].priority).toBe('high');
    expect(result[1].priority).toBe('medium');
  });

  it('each entry has exactly 3 steps ordered 1-2-3', () => {
    const result = heuristicGenerateTestCases(diffWithFiles);
    for (const tc of result) {
      expect(tc.steps).toHaveLength(3);
      expect(tc.steps.map((s) => s.order)).toEqual([1, 2, 3]);
    }
  });

  it('sets the correct metadata fields', () => {
    const [first] = heuristicGenerateTestCases(diffWithFiles);
    expect(first.status).toBe('not_tested');
    expect(first.isAiGenerated).toBe(true);
    expect(first.tags).toContain('ai-offline');
    expect(first.testType).toBe('manual');
    expect(first.folderId).toBeNull();
  });

  it('returns a single fallback entry for empty diff', () => {
    const result = heuristicGenerateTestCases('');
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe('high');
  });

  it('caps results at 5 entries', () => {
    const bigDiff = Array.from(
      { length: 7 },
      (_, i) => `diff --git a/file${i}.ts b/file${i}.ts`,
    ).join('\n');
    const result = heuristicGenerateTestCases(bigDiff);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

// ── heuristicWhatToTest ───────────────────────────────────────────────────────

describe('heuristicWhatToTest', () => {
  it('returns exactly 3 recommendations', () => {
    const result = heuristicWhatToTest('[abc1234] fix bug\n[def5678] add feature\n[111aaaa] refactor');
    expect(result.recommendations).toHaveLength(3);
  });

  it('sets source to heuristic', () => {
    expect(heuristicWhatToTest('anything').source).toBe('heuristic');
  });

  it('counts commit hashes in the first recommendation', () => {
    const result = heuristicWhatToTest('[abc1234] fix\n[def5678] add\n[111aaaa] rm');
    expect(result.recommendations[0]).toContain('3');
  });

  it('defaults to 1 commit when no hashes match', () => {
    const result = heuristicWhatToTest('no hashes here');
    expect(result.recommendations[0]).toContain('1');
  });
});

// ── heuristicChat ─────────────────────────────────────────────────────────────

function makeMessages(systemContent: string, userMsg: string) {
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userMsg },
  ];
}

function makeSystem({
  repoName = 'my-repo',
  testCases = '',
  commits = '',
  docs = '',
}: {
  repoName?: string;
  testCases?: string;
  commits?: string;
  docs?: string;
}) {
  return `You are a QA assistant for repository "${repoName}".
## Recent Test Cases
${testCases}
## Recent Commits
${commits}
## Project Documentation
${docs}`;
}

describe('heuristicChat — intent: risk', () => {
  it('responds in English when lang=en and no high-risk commits', () => {
    const msgs = makeMessages(makeSystem({}), 'any risk?');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('No high-risk commits');
  });

  it('responds in Thai by default when no high-risk commits', () => {
    const msgs = makeMessages(makeSystem({}), 'any risk?');
    const result = heuristicChat(msgs);
    expect(result).toContain('ไม่พบ commit ความเสี่ยงสูง');
  });

  it('lists high-risk commits when present', () => {
    const system = makeSystem({
      commits: '- [high risk] Rewrite auth module — session handling changed',
    });
    const msgs = makeMessages(system, 'show me risk areas');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('[high]');
    expect(result).toContain('Rewrite auth module');
  });
});

describe('heuristicChat — intent: priority', () => {
  it('mentions failing tests when present', () => {
    const system = makeSystem({
      testCases: '- [failed/high] Login form validation',
    });
    const msgs = makeMessages(system, 'what should I test first?');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('Login form validation');
  });

  it('returns no-issues message when nothing needs attention', () => {
    const msgs = makeMessages(makeSystem({}), 'what to prioritize?');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('No failing tests');
  });
});

describe('heuristicChat — intent: list', () => {
  it('indicates no test cases when list is empty', () => {
    const msgs = makeMessages(makeSystem({}), 'show all test cases');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('No test cases found');
  });

  it('groups test cases by status', () => {
    const system = makeSystem({
      testCases: `- [pass/high] Login works
- [fail/medium] Password reset`,
    });
    const msgs = makeMessages(system, 'list all tests');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('pass');
    expect(result).toContain('fail');
    expect(result).toContain('Login works');
    expect(result).toContain('Password reset');
  });
});

describe('heuristicChat — intent: generate', () => {
  it('returns a TypeScript describe block', () => {
    const msgs = makeMessages(makeSystem({}), 'generate cypress test');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('```typescript');
    expect(result).toContain('describe(');
  });
});

describe('heuristicChat — intent: docs', () => {
  it('reports no documentation when docs are empty', () => {
    // 'about this' matches the docs regex without matching list keywords
    const msgs = makeMessages(makeSystem({}), 'tell me about this project');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('No project documentation');
  });

  it('returns truncated docs when docs are present', () => {
    const system = makeSystem({ docs: 'This project does X.' });
    const msgs = makeMessages(system, 'project readme please');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('This project does X.');
  });
});

describe('heuristicChat — intent: commits', () => {
  it('reports no commits when section is empty', () => {
    // 'commit' matches the commits regex; avoid 'show' which triggers list first
    const msgs = makeMessages(makeSystem({}), 'what commits happened recently');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('No recent commit analysis');
  });

  it('lists commits when present', () => {
    const system = makeSystem({ commits: '- [low risk] Minor fix\n- [high risk] Big refactor' });
    const msgs = makeMessages(system, 'latest changes');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('Minor fix');
    expect(result).toContain('Big refactor');
  });
});

describe('heuristicChat — intent: general', () => {
  it('returns an overview with test case count', () => {
    const system = makeSystem({ testCases: '- [pass/high] TC 1\n- [fail/medium] TC 2' });
    const msgs = makeMessages(system, 'hello');
    const result = heuristicChat(msgs, 'en');
    expect(result).toContain('2');
  });
});
