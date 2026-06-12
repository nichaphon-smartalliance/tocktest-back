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
