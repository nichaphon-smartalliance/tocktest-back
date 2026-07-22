import { isRelevantSourceFile, renderDocMarkdown, summarizeSourceFile } from './doc-markdown.util';

describe('isRelevantSourceFile', () => {
  it('rejects non-blob tree entries (directories)', () => {
    expect(isRelevantSourceFile('src/foo', 'tree')).toBe(false);
  });

  it('rejects node_modules/.next/dist paths even if they look relevant', () => {
    expect(isRelevantSourceFile('node_modules/foo/index.ts', 'blob')).toBe(false);
    expect(isRelevantSourceFile('.next/server/foo.js', 'blob')).toBe(false);
    expect(isRelevantSourceFile('dist/main.js', 'blob')).toBe(false);
  });

  it('always allows package.json and README.md at any casing', () => {
    expect(isRelevantSourceFile('package.json', 'blob')).toBe(true);
    expect(isRelevantSourceFile('README.md', 'blob')).toBe(true);
    expect(isRelevantSourceFile('readme.md', 'blob')).toBe(true);
  });

  it('rejects files outside src/ (other than the two allowlisted names)', () => {
    expect(isRelevantSourceFile('scripts/build.ts', 'blob')).toBe(false);
  });

  it('accepts recognized extensions under src/', () => {
    expect(isRelevantSourceFile('src/app.module.ts', 'blob')).toBe(true);
    expect(isRelevantSourceFile('src/components/Foo.tsx', 'blob')).toBe(true);
    expect(isRelevantSourceFile('src/data.json', 'blob')).toBe(true);
  });

  it('rejects unrecognized extensions under src/', () => {
    expect(isRelevantSourceFile('src/logo.png', 'blob')).toBe(false);
    expect(isRelevantSourceFile('src/styles.css', 'blob')).toBe(false);
  });
});

describe('summarizeSourceFile', () => {
  it('extracts an exported class name as the title', () => {
    const entry = summarizeSourceFile('src/services/foo.ts', 'sha1', 'export class FooService {}');
    expect(entry.title).toBe('FooService');
    expect(entry.section).toBe('Services');
  });

  it('extracts an exported function name when no class is present', () => {
    const entry = summarizeSourceFile('src/lib/util.ts', 'sha2', 'export function doThing() {}');
    expect(entry.title).toBe('doThing');
  });

  it('falls back to the filename when nothing is extractable', () => {
    const entry = summarizeSourceFile('src/data/constants.ts', 'sha3', 'const x = 1;');
    expect(entry.title).toBe('constants.ts');
  });

  it('resolves section by path convention', () => {
    // Note: the /controller and /service checks match a directory segment
    // (e.g. "controllers/foo.ts"), not a ".controller.ts"/".service.ts"
    // filename suffix — that's the actual substring check in resolveSection.
    expect(summarizeSourceFile('src/controllers/foo.ts', 's', 'export class X {}').section).toBe('API Controllers');
    expect(summarizeSourceFile('src/services/foo.ts', 's', 'export class X {}').section).toBe('Services');
    expect(summarizeSourceFile('src/modules/foo/dto/foo.dto.ts', 's', 'export class X {}').section).toBe('DTOs');
    expect(summarizeSourceFile('src/modules/foo/entities/foo.entity.ts', 's', 'export class X {}').section).toBe('Entities and Models');
    expect(summarizeSourceFile('src/hooks/useFoo.ts', 's', 'export class X {}').section).toBe('Frontend Hooks');
    expect(summarizeSourceFile('src/components/Foo.tsx', 's', 'export class X {}').section).toBe('UI Components');
    expect(summarizeSourceFile('src/app/page.tsx', 's', 'export class X {}').section).toBe('Routes and Pages');
    expect(summarizeSourceFile('package.json', 's', '{}').section).toBe('Runtime and Tooling');
    expect(summarizeSourceFile('src/misc/thing.ts', 's', 'export class X {}').section).toBe('Other Sources');
  });

  it('summarizes controller route decorators', () => {
    const content = `
      class FooController {
        @Get('items')
        listItems() {}
      }
    `;
    const entry = summarizeSourceFile('src/modules/foo/foo.controller.ts', 's', content);
    expect(entry.summary[0]).toContain('GET items -> listItems()');
  });

  it('summarizes DTO/entity fields', () => {
    const content = `
      export class FooDto {
        name: string;
        age?: number;
      }
    `;
    const entry = summarizeSourceFile('src/modules/foo/dto/foo.dto.ts', 's', content);
    expect(entry.summary[0]).toContain('Fields: name, age');
  });

  it('falls back to a placeholder line for DTO/entity files with no fields', () => {
    const entry = summarizeSourceFile('src/modules/foo/entities/empty.entity.ts', 's', 'export class Empty {}');
    expect(entry.summary).toEqual(['Structured data definition used by the application.']);
  });

  it('summarizes plain methods when no route decorators are present', () => {
    const content = `
      export class Calculator {
        add(a, b) { return a + b; }
        subtract(a, b) { return a - b; }
      }
    `;
    const entry = summarizeSourceFile('src/modules/foo/calc.ts', 's', content);
    expect(entry.summary[0]).toContain('Methods:');
    expect(entry.summary[0]).toContain('add()');
  });
});

describe('renderDocMarkdown', () => {
  it('renders header metadata and change summary', () => {
    const md = renderDocMarkdown({
      repoFullName: 'acme/widgets',
      branch: 'main',
      headSha: 'abcdef1234567890',
      generatedAt: new Date('2024-01-01T00:00:00Z'),
      cache: {},
      offlineMode: false,
      changedPaths: ['src/a.ts'],
    });

    expect(md).toContain('# acme/widgets Documentation');
    expect(md).toContain('- Branch: `main`');
    expect(md).toContain('- Source commit: `abcdef123456`');
    expect(md).toContain('## Change Summary');
    expect(md).toContain('- src/a.ts');
  });

  it('reports no changes when changedPaths is empty', () => {
    const md = renderDocMarkdown({
      repoFullName: 'acme/widgets',
      branch: 'main',
      headSha: 'sha',
      generatedAt: new Date(),
      cache: {},
      offlineMode: false,
      changedPaths: [],
    });
    expect(md).toContain('No relevant source changes were detected');
  });

  it('groups cache entries by section in a fixed order', () => {
    const md = renderDocMarkdown({
      repoFullName: 'acme/widgets',
      branch: 'main',
      headSha: 'sha',
      generatedAt: new Date(),
      cache: {
        'src/modules/foo/foo.entity.ts': { path: 'src/modules/foo/foo.entity.ts', sha: 's1', section: 'Entities and Models', title: 'Foo', summary: ['Fields: id'] },
        'src/modules/foo/foo.controller.ts': { path: 'src/modules/foo/foo.controller.ts', sha: 's2', section: 'API Controllers', title: 'FooController', summary: ['GET / -> list()'] },
      },
      offlineMode: true,
      changedPaths: [],
    });

    const controllersIdx = md.indexOf('## API Controllers');
    const entitiesIdx = md.indexOf('## Entities and Models');
    expect(controllersIdx).toBeGreaterThan(-1);
    expect(entitiesIdx).toBeGreaterThan(-1);
    expect(controllersIdx).toBeLessThan(entitiesIdx);
    expect(md).toContain('Offline-safe deterministic generator');
  });

  it('shows "Summary unavailable" for entries with no summary lines', () => {
    const md = renderDocMarkdown({
      repoFullName: 'acme/widgets',
      branch: 'main',
      headSha: 'sha',
      generatedAt: new Date(),
      cache: {
        'src/x.ts': { path: 'src/x.ts', sha: 's', section: 'Other Sources', title: 'x.ts', summary: [] },
      },
      offlineMode: false,
      changedPaths: [],
    });
    expect(md).toContain('- Summary unavailable.');
  });
});
