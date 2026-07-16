import { normalizeRiskLevel, normalizePriority, normalizeTestType } from './normalize-ai';

describe('normalizeRiskLevel', () => {
  it.each(['low', 'medium', 'high', 'critical'])('returns %s unchanged', (v) => {
    expect(normalizeRiskLevel(v)).toBe(v);
  });

  it('lowercases uppercase input', () => {
    expect(normalizeRiskLevel('HIGH')).toBe('high');
    expect(normalizeRiskLevel('CRITICAL')).toBe('critical');
    expect(normalizeRiskLevel('Medium')).toBe('medium');
  });

  it('returns the default fallback for unknown values', () => {
    expect(normalizeRiskLevel('unknown')).toBe('medium');
    expect(normalizeRiskLevel('extreme')).toBe('medium');
    expect(normalizeRiskLevel('')).toBe('medium');
  });

  it('returns medium for null and undefined', () => {
    expect(normalizeRiskLevel(null)).toBe('medium');
    expect(normalizeRiskLevel(undefined)).toBe('medium');
  });

  it('uses a custom fallback when provided', () => {
    expect(normalizeRiskLevel('bogus', 'low')).toBe('low');
    expect(normalizeRiskLevel('bogus', 'critical')).toBe('critical');
  });
});

describe('normalizePriority', () => {
  it.each(['low', 'medium', 'high', 'critical'])('returns %s unchanged', (v) => {
    expect(normalizePriority(v)).toBe(v);
  });

  it('lowercases input', () => {
    expect(normalizePriority('HIGH')).toBe('high');
    expect(normalizePriority('LOW')).toBe('low');
  });

  it('falls back to medium for invalid input', () => {
    expect(normalizePriority('urgent')).toBe('medium');
    expect(normalizePriority(undefined)).toBe('medium');
    expect(normalizePriority(null)).toBe('medium');
  });

  it('uses a custom fallback', () => {
    expect(normalizePriority('invalid', 'high')).toBe('high');
  });
});

describe('normalizeTestType', () => {
  it.each(['manual', 'automated', 'ui', 'api', 'integration'])('returns %s unchanged', (v) => {
    expect(normalizeTestType(v)).toBe(v);
  });

  it('lowercases input', () => {
    expect(normalizeTestType('AUTOMATED')).toBe('automated');
    expect(normalizeTestType('UI')).toBe('ui');
  });

  it('falls back to manual for invalid input', () => {
    expect(normalizeTestType('e2e')).toBe('manual');
    expect(normalizeTestType('')).toBe('manual');
    expect(normalizeTestType(undefined)).toBe('manual');
    expect(normalizeTestType(null)).toBe('manual');
  });

  it('uses a custom fallback', () => {
    expect(normalizeTestType('invalid', 'api')).toBe('api');
  });
});
