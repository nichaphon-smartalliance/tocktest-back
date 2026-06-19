export function buildTestGenerationPrompt(diffs: string, projectContext?: string): string {
  const contextSection = projectContext
    ? `PROJECT CONTEXT (CLAUDE.md / README):\n${projectContext}\n\n`
    : '';
  return `คุณคือ QA Engineer ผู้เชี่ยวชาญ วิเคราะห์ code changes เหล่านี้และสร้าง test cases ที่ครอบคลุม

${contextSection}CODE CHANGES:
${diffs}

สร้าง test cases ในรูปแบบ JSON array เท่านั้น ห้ามมีข้อความอื่น:
[
  {
    "title": "ชื่อ test case ชัดเจนและกระชับ",
    "description": "คำอธิบายสิ่งที่ทดสอบ",
    "steps": [
      {"order": 1, "description": "ขั้นตอนที่ 1"},
      {"order": 2, "description": "ขั้นตอนที่ 2"}
    ],
    "expectedResult": "ผลลัพธ์ที่คาดหวัง",
    "testType": "manual|automated|ui|api|integration",
    "priority": "low|medium|high|critical",
    "tags": ["tag1", "tag2"]
  }
]

สร้างอย่างน้อย 3-8 test cases ที่ครอบคลุม: happy path, edge cases, negative cases`;
}

export function buildPullRequestReviewPrompt(pullRequestData: string): string {
  return `Review this pull request like a senior QA-aware code reviewer. Focus on bugs, security issues, regression risk, missing validation, and performance problems.

PULL REQUEST DATA:
${pullRequestData}

Return JSON only:
{
  "summary": "Short overall review summary",
  "riskLevel": "low|medium|high|critical",
  "findings": [
    {
      "file": "path/to/file.ts",
      "severity": "low|medium|high|critical",
      "title": "Short issue title",
      "comment": "Clear explanation of the problem and why it matters",
      "suggestion": "Recommended fix or follow-up"
    }
  ],
  "mergeRecommendation": "approve|comment|request_changes"
}`;
}

export function buildCommitAnalysisPrompt(commitData: string): string {
  return `วิเคราะห์ commit นี้และให้ข้อมูลในรูปแบบ JSON เท่านั้น:

COMMIT DATA:
${commitData}

ตอบในรูปแบบ JSON เท่านั้น:
{
  "summary": "สรุปสิ่งที่เปลี่ยนแปลงใน 2-3 ประโยค",
  "riskLevel": "low|medium|high|critical",
  "testSuggestions": ["สิ่งที่ควรทดสอบ 1", "สิ่งที่ควรทดสอบ 2"],
  "affectedAreas": ["ส่วนที่ได้รับผลกระทบ"]
}`;
}

export function buildWhatToTestPrompt(commitsData: string): string {
  return `จาก commits เหล่านี้ ควรทดสอบอะไรบ้าง?

COMMITS:
${commitsData}

ตอบในรูปแบบ JSON เท่านั้น:
{
  "recommendations": ["สิ่งที่ควรทดสอบ 1", "สิ่งที่ควรทดสอบ 2", "สิ่งที่ควรทดสอบ 3"],
  "priority": "low|medium|high",
  "reasoning": "เหตุผลที่ควรทดสอบ"
}`;
}

export function buildDocUpdatePrompt(repoInfo: string, existingDoc: string): string {
  return `อัปเดต Project Documentation จาก code changes และข้อมูล repository นี้

REPOSITORY INFO:
${repoInfo}

EXISTING DOC:
${existingDoc}

เขียน documentation ที่อัปเดตแล้วในรูปแบบ Markdown ครอบคลุม:
- ภาพรวมระบบ
- Business Flows หลัก
- Modules สำคัญ
- Testing Strategy
- Known Limitations

ตอบด้วย Markdown content เท่านั้น ไม่มีข้อความอื่น`;
}
