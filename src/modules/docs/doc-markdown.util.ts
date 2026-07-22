// Deterministic (non-AI) source-file summarization and markdown rendering for
// the docs generator. Pure functions — no I/O, no DI — split out of
// DocsService so the "how do we describe a source file" logic can be tested
// and reasoned about independently of doc CRUD/versioning or GitHub fetching.

export interface SourceTreeItem {
  path: string;
  sha: string;
  type: string;
  size?: number;
}

export interface SourceCacheEntry {
  path: string;
  sha: string;
  section: string;
  title: string;
  summary: string[];
}

export function isRelevantSourceFile(filePath: string, itemType: string): boolean {
  if (itemType !== 'blob') return false;
  if (filePath.startsWith('node_modules/') || filePath.startsWith('.next/') || filePath.startsWith('dist/')) {
    return false;
  }

  const lcPath = filePath.toLowerCase();
  if (lcPath === 'package.json' || lcPath === 'readme.md') return true;
  if (!lcPath.startsWith('src/')) return false;

  return /\.(ts|tsx|js|jsx|json|md)$/.test(lcPath);
}

export function summarizeSourceFile(filePath: string, sha: string, content: string): SourceCacheEntry {
  const title = extractTitle(filePath, content);
  const section = resolveSection(filePath);
  const summary = extractSummaryLines(filePath, content);

  return { path: filePath, sha, section, title, summary };
}

function extractTitle(filePath: string, content: string): string {
  const classMatch = content.match(/export\s+class\s+([A-Za-z0-9_]+)/);
  if (classMatch) return classMatch[1];
  const fnMatch = content.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/) ?? content.match(/export\s+function\s+([A-Za-z0-9_]+)/);
  if (fnMatch) return fnMatch[1];
  return filePath.split('/').pop() ?? filePath;
}

function resolveSection(filePath: string): string {
  const lcPath = filePath.toLowerCase();
  if (lcPath.includes('/controller')) return 'API Controllers';
  if (lcPath.includes('/service')) return 'Services';
  if (lcPath.includes('/dto/')) return 'DTOs';
  if (lcPath.includes('/entities/')) return 'Entities and Models';
  if (lcPath.includes('/hooks/')) return 'Frontend Hooks';
  if (lcPath.includes('/components/')) return 'UI Components';
  if (lcPath.includes('/app/')) return 'Routes and Pages';
  if (lcPath.endsWith('package.json')) return 'Runtime and Tooling';
  return 'Other Sources';
}

function extractSummaryLines(filePath: string, content: string): string[] {
  const lines: string[] = [];
  const normalized = content.replace(/\r/g, '');

  const routeDecorators = [...normalized.matchAll(/@(Get|Post|Put|Delete|Patch)\(([^)]*)\)[\s\S]*?\n\s*([A-Za-z0-9_]+)\(/g)];
  if (routeDecorators.length > 0) {
    for (const match of routeDecorators.slice(0, 8)) {
      lines.push(`${match[1].toUpperCase()} ${cleanRoute(match[2])} -> ${match[3]}()`);
    }
    return lines;
  }

  const propertyMatches = [...normalized.matchAll(/^\s*([A-Za-z0-9_]+)\??:\s*[^;]+;/gm)];
  if (filePath.includes('/dto/') || filePath.includes('/entities/')) {
    if (propertyMatches.length > 0) {
      lines.push(`Fields: ${propertyMatches.slice(0, 10).map((match) => match[1]).join(', ')}`);
    }
    return lines.length > 0 ? lines : ['Structured data definition used by the application.'];
  }

  const methodMatches = [...normalized.matchAll(/^\s*(?:async\s+)?([A-Za-z0-9_]+)\([^)]*\)\s*[{:]/gm)];
  if (methodMatches.length > 0) {
    lines.push(`Methods: ${methodMatches.slice(0, 8).map((match) => `${match[1]}()`).join(', ')}`);
  }

  const importMatches = [...normalized.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)];
  if (filePath.includes('/hooks/') && importMatches.length > 0) {
    lines.push(`Depends on: ${importMatches.slice(0, 5).map((match) => match[1]).join(', ')}`);
  }

  const exportedConst = normalized.match(/export\s+const\s+([A-Za-z0-9_]+)/);
  if (exportedConst) {
    lines.push(`Exports ${exportedConst[1]}.`);
  }

  if (lines.length === 0) {
    const commentLine = normalized
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('import ') && !line.startsWith('export ') && !line.startsWith('//'));
    if (commentLine) lines.push(commentLine.slice(0, 140));
  }

  return lines.length > 0 ? lines : ['Application source file referenced by the generated docs workflow.'];
}

function cleanRoute(rawRoute: string): string {
  const trimmed = rawRoute.trim();
  if (!trimmed || trimmed === "''" || trimmed === '""') return '/';
  return trimmed.replace(/^['"`]|['"`]$/g, '') || '/';
}

const SECTION_ORDER = [
  'Runtime and Tooling',
  'Routes and Pages',
  'API Controllers',
  'Services',
  'DTOs',
  'Entities and Models',
  'Frontend Hooks',
  'UI Components',
  'Other Sources',
];

export function renderDocMarkdown(input: {
  repoFullName: string;
  branch: string;
  headSha: string;
  generatedAt: Date;
  cache: Record<string, SourceCacheEntry>;
  offlineMode: boolean;
  changedPaths: string[];
}): string {
  const grouped = new Map<string, SourceCacheEntry[]>();
  for (const entry of Object.values(input.cache)) {
    const list = grouped.get(entry.section) ?? [];
    list.push(entry);
    grouped.set(entry.section, list);
  }

  const chunks: string[] = [];
  chunks.push(`# ${input.repoFullName} Documentation`);
  chunks.push('');
  chunks.push(`- Branch: \`${input.branch}\``);
  chunks.push(`- Source commit: \`${input.headSha.slice(0, 12)}\``);
  chunks.push(`- Generated at: ${input.generatedAt.toISOString()}`);
  chunks.push(`- Mode: ${input.offlineMode ? 'Offline-safe deterministic generator' : 'Deterministic generator'}`);
  chunks.push(`- Cached source files: ${Object.keys(input.cache).length}`);
  chunks.push('');
  chunks.push('## Change Summary');
  chunks.push('');
  if (input.changedPaths.length === 0) {
    chunks.push('- No relevant source changes were detected since the previous docs build.');
  } else {
    for (const path of input.changedPaths.slice(0, 30)) {
      chunks.push(`- ${path}`);
    }
  }

  for (const section of SECTION_ORDER) {
    const entries = (grouped.get(section) ?? []).sort((a, b) => a.path.localeCompare(b.path));
    if (entries.length === 0) continue;
    chunks.push('');
    chunks.push(`## ${section}`);
    chunks.push('');
    for (const entry of entries) {
      chunks.push(`### ${entry.title}`);
      chunks.push('');
      chunks.push(`- File: \`${entry.path}\``);
      if (entry.summary.length === 0) {
        chunks.push('- Summary unavailable.');
      } else {
        for (const line of entry.summary) {
          chunks.push(`- ${line}`);
        }
      }
      chunks.push('');
    }
  }

  return chunks.join('\n').trim();
}
