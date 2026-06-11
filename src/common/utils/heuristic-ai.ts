import { normalizeRiskLevel } from './normalize-ai';

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
  let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
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

export function heuristicGenerateTestCases(diffs: string) {
  const commitCount = (diffs.match(/--- Commit [a-f0-9]+ ---/gi) ?? []).length || 1;
  const fileHints = (diffs.match(/^diff --git a\/(.+?) b\//gm) ?? [])
    .map((line) => line.replace(/^diff --git a\/(.+?) b\/.+$/, "$1"))
    .slice(0, 3);

  const areas =
    fileHints.length > 0
      ? fileHints.map((f) => `ไฟล์ ${f}`)
      : [`code changes จาก ${commitCount} commit ในช่วงที่เลือก`];

  return areas.map((area, index) => ({
    title: `[Heuristic] ทดสอบ ${area}`,
    description: `AI offline — test case พื้นฐานจาก ${area}`,
    steps: [
      { order: 1, description: "เตรียม environment และข้อมูลทดสอบ" },
      { order: 2, description: `ทดสอบ flow หลักที่เกี่ยวข้องกับ ${area}` },
      { order: 3, description: "ตรวจสอบผลลัพธ์และ regression" },
    ],
    expectedResult: "ระบบทำงานถูกต้อง ไม่มี regression",
    testType: "manual" as const,
    status: "not_tested" as const,
    priority: index === 0 ? ("high" as const) : ("medium" as const),
    tags: ["heuristic", "ai-offline"],
    isAiGenerated: true,
    folderId: null,
  }));
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
