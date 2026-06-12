import { Injectable } from '@nestjs/common';
import type { TestCase } from './entities/test-case.entity';

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

@Injectable()
export class TestExportService {
  generatePlaywright(repoName: string, testCases: TestCase[]): string {
    const describe = slugify(repoName) || 'generated';
    const tests = testCases
      .map((tc) => {
        const steps = (tc.steps ?? []).map((s) => `  // ${s.description}`).join('\n');
        const expected = tc.expectedResult ? `  // Expected: ${tc.expectedResult.replace(/\n/g, ' ')}` : '';
        return `
  test('${esc(tc.title)}', async ({ page }) => {
    // Priority: ${tc.priority} | Type: ${tc.testType}
${steps}
${expected}
    // TODO: implement assertions
    await expect(page).toBeTruthy();
  });`;
      })
      .join('\n');

    return `import { test, expect } from '@playwright/test';

test.describe('${esc(repoName)} — Generated QA', () => {
${tests}
});
`;
  }

  generateCypress(repoName: string, testCases: TestCase[]): string {
    const tests = testCases
      .map((tc) => {
        const steps = (tc.steps ?? []).map((s) => `    // ${s.description}`).join('\n');
        const expected = tc.expectedResult ? `    // Expected: ${tc.expectedResult.replace(/\n/g, ' ')}` : '';
        return `
  it('${esc(tc.title)}', () => {
    // Priority: ${tc.priority} | Type: ${tc.testType}
${steps}
${expected}
    // TODO: implement assertions
    cy.wrap(true).should('exist');
  });`;
      })
      .join('\n');

    return `describe('${esc(repoName)} — Generated QA', () => {
${tests}
});
`;
  }
}
