const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const TEST_TYPES = ['manual', 'automated', 'ui', 'api', 'integration'] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type TestType = (typeof TEST_TYPES)[number];

export function normalizeRiskLevel(value: unknown, fallback: RiskLevel = 'medium'): RiskLevel {
  const v = String(value ?? '').toLowerCase();
  return (RISK_LEVELS as readonly string[]).includes(v) ? (v as RiskLevel) : fallback;
}

export function normalizePriority(value: unknown, fallback: Priority = 'medium'): Priority {
  const v = String(value ?? '').toLowerCase();
  return (PRIORITIES as readonly string[]).includes(v) ? (v as Priority) : fallback;
}

export function normalizeTestType(value: unknown, fallback: TestType = 'manual'): TestType {
  const v = String(value ?? '').toLowerCase();
  return (TEST_TYPES as readonly string[]).includes(v) ? (v as TestType) : fallback;
}
