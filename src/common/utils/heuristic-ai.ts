import { normalizeRiskLevel } from './normalize-ai';

// ── Heuristic QA Chat ─────────────────────────────────────────────────────────

interface ParsedContext {
  repoName: string;
  testCases: Array<{ status: string; priority: string; title: string }>;
  commits: Array<{ risk: string; message: string; summary?: string }>;
  docs: string;
}

function parseContext(systemPrompt: string): ParsedContext {
  const repoName = systemPrompt.match(/repository "([^"]+)"/)?.[1] ?? 'this repo';

  const tcSection = systemPrompt.match(/## Recent Test Cases[^\n]*\n([\s\S]*?)(?=\n##|$)/)?.[1] ?? '';
  const testCases = [...tcSection.matchAll(/- \[([^/\]]+)\/([^\]]+)\] (.+)/g)].map((m) => ({
    status: m[1].trim(),
    priority: m[2].trim(),
    title: m[3].trim(),
  }));

  const cmSection = systemPrompt.match(/## Recent Commits\n([\s\S]*?)(?=\n##|$)/)?.[1] ?? '';
  const commits = [...cmSection.matchAll(/- \[([^\]]+) risk\] (.+?)(?:\s*—\s*(.+))?$/gm)].map((m) => ({
    risk: m[1].trim(),
    message: m[2].trim(),
    summary: m[3]?.trim(),
  }));

  const docs = systemPrompt.match(/## Project Documentation\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim() ?? '';

  return { repoName, testCases, commits, docs };
}

function classify(msg: string): string {
  const m = msg.toLowerCase();
  if (/generat|creat|write|cypress|test code|script/.test(m)) return 'generate';
  if (/risk|danger|critical|high.risk|unsafe|risky|concern/.test(m)) return 'risk';
  if (/what.*test|area.*test|test.*first|priorit|focus|where.*start/.test(m)) return 'priority';
  if (/list|show|status|all test|test case|summary|overview/.test(m)) return 'list';
  if (/recent commit|latest change|what.*change|commit/.test(m)) return 'commits';
  if (/doc|readme|project info|about this/.test(m)) return 'docs';
  return 'general';
}

export function heuristicChat(messages: Array<{ role: string; content: string }>): string {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMsg = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const ctx = parseContext(system);
  const intent = classify(userMsg);

  const { testCases, commits, repoName } = ctx;
  const highRisk = commits.filter((c) => c.risk === 'high' || c.risk === 'critical');
  const failing = testCases.filter((tc) => tc.status === 'failed');
  const untested = testCases.filter((tc) => tc.status === 'not_tested');
  const highPri = testCases.filter((tc) => tc.priority === 'high' || tc.priority === 'critical');

  if (intent === 'risk') {
    if (highRisk.length === 0) return `No high-risk commits found in recent history for **${repoName}**. All recent changes appear low-to-medium risk.`;
    const lines = highRisk.map((c) => `- **[${c.risk}]** ${c.message}${c.summary ? ` — ${c.summary}` : ''}`).join('\n');
    return `### High-Risk Changes in ${repoName}\n\n${lines}\n\nRecommend running full regression on affected areas before release.`;
  }

  if (intent === 'priority') {
    const parts: string[] = [`### Where to Focus Testing — ${repoName}\n`];
    if (failing.length > 0) {
      parts.push(`**Failing tests (fix first):**\n${failing.map((tc) => `- ${tc.title}`).join('\n')}`);
    }
    if (highRisk.length > 0) {
      parts.push(`**High-risk recent changes (cover with tests):**\n${highRisk.map((c) => `- ${c.message}`).join('\n')}`);
    }
    if (highPri.length > 0) {
      parts.push(`**High-priority untested cases:**\n${untested.filter((tc) => tc.priority === 'high' || tc.priority === 'critical').slice(0, 5).map((tc) => `- ${tc.title}`).join('\n') || 'None'}`);
    }
    if (parts.length === 1) parts.push('No failing tests or high-risk commits found. Focus on adding coverage for untested areas.');
    return parts.join('\n\n');
  }

  if (intent === 'list') {
    if (testCases.length === 0) return `No test cases found for **${repoName}** yet. Use the Test Cases page to create some.`;
    const byStatus: Record<string, string[]> = {};
    for (const tc of testCases) {
      (byStatus[tc.status] ??= []).push(tc.title);
    }
    const lines = Object.entries(byStatus).map(([s, titles]) =>
      `**${s}** (${titles.length})\n${titles.map((t) => `  - ${t}`).join('\n')}`,
    );
    return `### Test Cases — ${repoName}\n\n${lines.join('\n\n')}`;
  }

  if (intent === 'commits') {
    if (commits.length === 0) return `No recent commit analysis found for **${repoName}**. Run Commit Analysis from the Analysis page first.`;
    const lines = commits.map((c) => `- **[${c.risk} risk]** ${c.message}${c.summary ? `\n  ${c.summary}` : ''}`).join('\n');
    return `### Recent Commits — ${repoName}\n\n${lines}`;
  }

  if (intent === 'generate') {
    const relevant = testCases.slice(0, 3);
    const specLines = relevant.length > 0
      ? relevant.map((tc) => `  // ${tc.title}\n  it('${tc.title}', () => {\n    // TODO: implement\n  });`).join('\n\n')
      : `  it('should work as expected', () => {\n    // TODO: implement\n  });`;
    return `Here is a Cypress TypeScript template based on existing test cases in **${repoName}**:\n\n\`\`\`typescript\ndescribe('${repoName} — QA Suite', () => {\n  beforeEach(() => {\n    cy.visit('/');\n  });\n\n${specLines}\n});\n\`\`\`\n\n> Refine each \`it\` block with actual selectors and assertions from your app.`;
  }

  if (intent === 'docs') {
    if (!ctx.docs) return `No project documentation found for **${repoName}**. Add docs via the Docs page.`;
    return `### Project Documentation — ${repoName}\n\n${ctx.docs.slice(0, 1000)}${ctx.docs.length > 1000 ? '\n\n*(truncated — see Docs page for full content)*' : ''}`;
  }

  // general fallback — give real overview
  const summary: string[] = [`**${repoName}** QA overview:\n`];
  if (testCases.length > 0) {
    const statMap = testCases.reduce<Record<string, number>>((acc, tc) => { acc[tc.status] = (acc[tc.status] ?? 0) + 1; return acc; }, {});
    summary.push(`**Test cases:** ${testCases.length} total — ${Object.entries(statMap).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  } else {
    summary.push('No test cases yet.');
  }
  if (commits.length > 0) {
    summary.push(`**Recent commits:** ${commits.length} analyzed — ${highRisk.length} high/critical risk`);
  }
  if (failing.length > 0) summary.push(`**${failing.length} failing test(s) need attention.**`);
  summary.push('\nAsk me about: test priorities, risk areas, commit changes, or to generate a Cypress test.');
  return summary.join('\n');
}

type CommitStats = { files?: number; additions?: number; deletions?: number; message?: string };

function parseCommitStats(commitData: string): CommitStats {
  try {
    const d = JSON.parse(commitData);
    return {
      files: d.stats?.total ?? d.files?.length ?? 0,
      additions: d.stats?.additions ?? 0,
      deletions: d.stats?.deletions ?? 0,
      message: d.message ?? d.commit?.message,
    };
  } catch {
    return { files: 0, additions: 0, deletions: 0 };
  }
}

function scoreRisk(files: number, churn: number): 'low' | 'medium' | 'high' | 'critical' {
  let level: 'low' | 'medium' | 'high' | 'critical';
  if (churn < 50) level = 'low';
  else if (churn < 300) level = 'medium';
  else if (churn < 1000) level = 'high';
  else level = 'critical';
  if (files > 10) {
    const order = ['low', 'medium', 'high', 'critical'] as const;
    const i = order.indexOf(level);
    if (i < order.length - 1) level = order[i + 1];
  }
  return level;
}

export function heuristicAnalyzeCommit(commitData: string) {
  const { files = 0, additions = 0, deletions = 0, message } = parseCommitStats(commitData);
  const churn = additions + deletions;
  const riskLevel = normalizeRiskLevel(scoreRisk(files, churn));
  const summary = `[วิเคราะห์แบบ heuristic — AI offline] ${message ? `"${String(message).slice(0, 80)}" · ` : ''}แก้ไข ${files} ไฟล์ (+${additions}/-${deletions} บรรทัด)`;
  return {
    summary,
    riskLevel,
    testSuggestions: ['ทดสอบ flow หลักที่เกี่ยวข้องกับไฟล์ที่แก้ไข', 'ตรวจ regression ในส่วนที่มีการเปลี่ยนแปลงมาก'],
    affectedAreas: files > 0 ? ['ไฟล์ที่แก้ไขใน commit'] : [],
    source: 'heuristic' as const,
  };
}

function extractChangedFiles(diffs: string): string[] {
  const files = new Set<string>();
  for (const m of diffs.matchAll(/^diff --git a\/(.+?) b\/.+$/gm)) {
    if (m[1]) files.add(m[1]);
  }
  return [...files].slice(0, 5);
}

function fileLabel(path: string): string {
  return path.split("/").pop() ?? path;
}

export function heuristicGenerateTestCases(diffs: string) {
  const commitCount = (diffs.match(/--- Commit [a-f0-9]+ ---/gi) ?? []).length || 1;
  const files = extractChangedFiles(diffs);
  const targets =
    files.length > 0
      ? files.map((path) => ({ path, label: fileLabel(path) }))
      : [{ path: "", label: `${commitCount} commit` }];

  return targets.map((target, index) => {
    const scope = files.length > 0 ? `ไฟล์ ${target.label}` : `การเปลี่ยนแปลง ${commitCount} commit`;
    return {
      title: `ทดสอบ regression — ${scope}`,
      description:
        files.length > 0
          ? `ตรวจสอบการทำงานหลังแก้ไข ${target.path} (AI offline — template พื้นฐาน)`
          : `ตรวจสอบ flow หลักจาก commit ในช่วงเวลาที่เลือก (AI offline — template พื้นฐาน)`,
      steps: [
        { order: 1, description: "เตรียม environment และข้อมูลทดสอบ" },
        { order: 2, description: `ทดสอบ flow หลักที่เกี่ยวข้องกับ ${scope}` },
        { order: 3, description: "ตรวจสอบผลลัพธ์และ regression" },
      ],
      expectedResult: "ระบบทำงานถูกต้อง ไม่มี regression",
      testType: "manual" as const,
      status: "not_tested" as const,
      priority: index === 0 ? ("high" as const) : ("medium" as const),
      tags: ["ai-offline"],
      isAiGenerated: true,
      folderId: null,
    };
  });
}

export function heuristicWhatToTest(commitsData: string) {
  const count = (commitsData.match(/\[[0-9a-f]{7}\]/gi) ?? []).length || 1;
  return {
    recommendations: [
      `AI offline — ทดสอบ flow หลักที่เกี่ยวข้องกับ ${count} commit ที่เลือก`,
      'ทดสอบ regression ในส่วนที่มีการเปลี่ยนแปลงมากที่สุด',
      'ตรวจสอบ edge cases ของฟีเจอร์ที่ commit message ระบุ',
    ],
    priority: 'medium' as const,
    reasoning: 'AI server ไม่พร้อม — ใช้คำแนะนำพื้นฐานจากข้อมูล commit',
    source: 'heuristic' as const,
  };
}
