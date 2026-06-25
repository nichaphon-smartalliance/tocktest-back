# Docs Cross-Account Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make docs visible and deletable across all user accounts that have synced the same GitHub repo, and show the deleter's email in version history.

**Architecture:** Apply `getSharedRepoIds()` (the same pattern used for test cases) to all doc read/delete operations. Add two nullable columns to `repo_settings` for tracking the last deletion. No new tables, no data migration.

**Tech Stack:** NestJS + TypeORM (PostgreSQL), Next.js 14, React Query, TypeScript

---

## Files

| Action | Path |
|---|---|
| Modify | `tocktest-back/src/main.ts` |
| Modify | `tocktest-back/src/modules/settings/entities/repo-settings.entity.ts` |
| Modify | `tocktest-back/src/modules/docs/docs.module.ts` |
| Modify | `tocktest-back/src/modules/docs/docs.service.ts` |
| Modify | `tocktest-front/src/types/api/main/docs.ts` |
| Modify | `tocktest-front/src/types/app/docs/index.ts` |
| Modify | `tocktest-front/src/components/partials/Docs/DocsContent.tsx` |

---

### Task 1: Add `docsDeletedByEmail` + `docsDeletedAt` columns to the database

**Files:**
- Modify: `tocktest-back/src/main.ts` (inside `ensureRepoSettingsEnhancements`)
- Modify: `tocktest-back/src/modules/settings/entities/repo-settings.entity.ts`

- [ ] **Step 1: Add two `ALTER TABLE` statements to `ensureRepoSettingsEnhancements` in `main.ts`**

Open `tocktest-back/src/main.ts`. Inside `ensureRepoSettingsEnhancements`, append two lines after the existing `docs_source_cache` line:

```typescript
async function ensureRepoSettingsEnhancements(dataSource: DataSource) {
  try {
    await dataSource.query("ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS ai_offline_mode BOOLEAN NOT NULL DEFAULT false");
    await dataSource.query("ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_auto_sync BOOLEAN NOT NULL DEFAULT false");
    await dataSource.query("ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_sync_status VARCHAR(20) NOT NULL DEFAULT 'idle'");
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_sync_message TEXT');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_last_generated_at TIMESTAMPTZ');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_last_commit_sha VARCHAR(64)');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_last_source_sha VARCHAR(64)');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_source_cache JSONB');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_deleted_by_email VARCHAR(255)');
    await dataSource.query('ALTER TABLE repo_settings ADD COLUMN IF NOT EXISTS docs_deleted_at TIMESTAMPTZ');
  } catch (error) {
    console.warn('Could not ensure repo_settings enhancements:', (error as Error)?.message ?? error);
  }
}
```

- [ ] **Step 2: Add the two columns to the `RepoSettings` entity**

Open `tocktest-back/src/modules/settings/entities/repo-settings.entity.ts`. Add these two columns after `docsSourceCache`:

```typescript
  @Column({ name: 'docs_deleted_by_email', nullable: true, type: 'varchar' })
  docsDeletedByEmail: string | null;

  @Column({ name: 'docs_deleted_at', nullable: true, type: 'timestamptz' })
  docsDeletedAt: Date | null;
```

- [ ] **Step 3: Verify the backend still compiles**

```bash
cd tocktest-back
npm run build
```

Expected: `Build successful` with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd tocktest-back
git add src/main.ts src/modules/settings/entities/repo-settings.entity.ts
git commit -m "feat(docs): add deletion audit columns to repo_settings"
```

---

### Task 2: Wire `UsersModule` into `DocsModule`

**Files:**
- Modify: `tocktest-back/src/modules/docs/docs.module.ts`

- [ ] **Step 1: Import `UsersModule` in `DocsModule`**

Replace the entire file `tocktest-back/src/modules/docs/docs.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectDoc } from './entities/project-doc.entity';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { RepoSettings } from '../settings/entities/repo-settings.entity';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectDoc, RepoSettings]),
    GithubTokensModule,
    RepositoriesModule,
    UsersModule,
  ],
  controllers: [DocsController],
  providers: [DocsService],
})
export class DocsModule {}
```

- [ ] **Step 2: Verify build**

```bash
cd tocktest-back
npm run build
```

Expected: `Build successful`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/docs/docs.module.ts
git commit -m "feat(docs): wire UsersModule into DocsModule for email lookup"
```

---

### Task 3: Update `DocsService` — reads and write

**Files:**
- Modify: `tocktest-back/src/modules/docs/docs.service.ts`

This task updates `getLatestDoc`, `updateDoc`, `getVersions`, and adds a private helper `clearDeletionInfoAcrossSharedRepos`.

- [ ] **Step 1: Add `In` import and `UsersService` import + inject**

At the top of `docs.service.ts`, change the typeorm import line and add the UsersService import:

```typescript
import { Repository as TypeOrmRepo, In } from 'typeorm';
```

```typescript
import { UsersService } from '../users/users.service';
```

In the constructor, add `UsersService` as a parameter:

```typescript
constructor(
  @InjectRepository(ProjectDoc)
  private readonly docRepo: TypeOrmRepo<ProjectDoc>,
  @InjectRepository(RepoSettings)
  private readonly settingsRepo: TypeOrmRepo<RepoSettings>,
  private readonly repoService: RepositoriesService,
  private readonly githubTokensService: GithubTokensService,
  private readonly usersService: UsersService,
) {}
```

- [ ] **Step 2: Export `DocHistoryEntry` type**

Add this type export directly after the `DocStatusResponse` interface (around line 36):

```typescript
export type DocHistoryEntry =
  | { kind: 'version'; id: string; version: number; updatedAt: Date; updatedBy: string | null }
  | { kind: 'deleted'; id: string; email: string; deletedAt: Date };
```

- [ ] **Step 3: Replace `getLatestDoc` to query across shared repos**

Replace the existing `getLatestDoc` method (`getSharedRepoIds` already verifies ownership via `findOneForUser` internally, so no separate call needed):

```typescript
async getLatestDoc(userId: string, repoId: string): Promise<ProjectDoc | null> {
  const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);
  return this.docRepo.findOne({
    where: sharedIds.map((id) => ({ repoId: id })),
    order: { version: 'DESC' },
  });
}
```

- [ ] **Step 4: Replace `updateDoc` to query version across shared repos and clear deletion info**

Replace the existing `updateDoc` method:

```typescript
async updateDoc(userId: string, repoId: string, content: string, latestVersion?: number): Promise<ProjectDoc> {
  await this.repoService.findOneForUser(userId, repoId);
  const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);

  let newVersion: number;
  if (latestVersion !== undefined) {
    newVersion = latestVersion + 1;
  } else {
    const latest = await this.docRepo.findOne({
      where: sharedIds.map((id) => ({ repoId: id })),
      select: ['version'],
      order: { version: 'DESC' },
    });
    newVersion = (latest?.version ?? 0) + 1;
  }

  const doc = this.docRepo.create({ repoId, content, version: newVersion, updatedBy: userId });
  const saved = await this.docRepo.save(doc);

  for (const id of sharedIds) {
    await this.settingsRepo.update({ repoId: id }, { docsDeletedByEmail: null, docsDeletedAt: null } as any);
  }

  return saved;
}
```

- [ ] **Step 5: Replace `getVersions` to query across shared repos and include deletion entry**

Replace the existing `getVersions` method:

```typescript
async getVersions(userId: string, repoId: string): Promise<DocHistoryEntry[]> {
  const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);

  const versions = await this.docRepo.find({
    where: sharedIds.map((id) => ({ repoId: id })),
    select: ['id', 'version', 'updatedAt', 'updatedBy'],
    order: { version: 'DESC' },
    take: 20,
  });

  const settings = await this.settingsRepo.findOne({ where: { repoId } });

  const entries: DocHistoryEntry[] = versions.map((v) => ({
    kind: 'version' as const,
    id: v.id,
    version: v.version,
    updatedAt: v.updatedAt,
    updatedBy: v.updatedBy,
  }));

  if (settings?.docsDeletedByEmail && settings.docsDeletedAt) {
    entries.unshift({
      kind: 'deleted' as const,
      id: `del-${settings.docsDeletedAt.getTime()}`,
      email: settings.docsDeletedByEmail,
      deletedAt: settings.docsDeletedAt,
    });
  }

  return entries;
}
```

- [ ] **Step 6: Add private helper `clearDeletionInfoAcrossSharedRepos`**

Add this private method after `getLatestDocVersion`:

```typescript
private async clearDeletionInfoAcrossSharedRepos(userId: string, repoId: string): Promise<void> {
  const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);
  for (const id of sharedIds) {
    await this.settingsRepo.update({ repoId: id }, { docsDeletedByEmail: null, docsDeletedAt: null } as any);
  }
}
```

- [ ] **Step 7: Call `clearDeletionInfoAcrossSharedRepos` in the two success paths inside `generateInBackground`**

In `generateInBackground`, find the early-return block:

```typescript
if (!forceFull && settings.docsLastCommitSha === head.commitSha && settings.docsLastSourceSha === head.treeSha) {
  await this.markStatus(repoId, 'success', 'Docs are already up to date.', {
    docsLastGeneratedAt: settings.docsLastGeneratedAt ?? new Date(),
  });
  return;
}
```

Replace it with:

```typescript
if (!forceFull && settings.docsLastCommitSha === head.commitSha && settings.docsLastSourceSha === head.treeSha) {
  await this.markStatus(repoId, 'success', 'Docs are already up to date.', {
    docsLastGeneratedAt: settings.docsLastGeneratedAt ?? new Date(),
  });
  await this.clearDeletionInfoAcrossSharedRepos(userId, repoId);
  return;
}
```

Then find the final `markStatus` success call at the end of `generateInBackground`:

```typescript
await this.markStatus(
  repoId,
  'success',
  changedPaths.size > 0
    ? `Docs updated from ${changedPaths.size} changed source file(s).`
    : 'Docs regenerated with no structural changes detected.',
  {
    docsLastGeneratedAt: new Date(),
    docsLastCommitSha: head.commitSha,
    docsLastSourceSha: head.treeSha,
    docsSourceCache: nextCache,
  },
);
```

Replace it with:

```typescript
await this.markStatus(
  repoId,
  'success',
  changedPaths.size > 0
    ? `Docs updated from ${changedPaths.size} changed source file(s).`
    : 'Docs regenerated with no structural changes detected.',
  {
    docsLastGeneratedAt: new Date(),
    docsLastCommitSha: head.commitSha,
    docsLastSourceSha: head.treeSha,
    docsSourceCache: nextCache,
  },
);
await this.clearDeletionInfoAcrossSharedRepos(userId, repoId);
```

- [ ] **Step 8: Verify build**

```bash
cd tocktest-back
npm run build
```

Expected: `Build successful`.

- [ ] **Step 9: Commit**

```bash
git add src/modules/docs/docs.service.ts
git commit -m "feat(docs): share docs across accounts using getSharedRepoIds"
```

---

### Task 4: Update `DocsService` — delete

**Files:**
- Modify: `tocktest-back/src/modules/docs/docs.service.ts`

- [ ] **Step 1: Replace `deleteDoc` to delete across all shared repos and stamp deletion info**

Replace the existing `deleteDoc` method:

```typescript
async deleteDoc(userId: string, repoId: string): Promise<void> {
  const sharedIds = await this.repoService.getSharedRepoIds(userId, repoId);
  const user = await this.usersService.findById(userId);
  const email = user?.email ?? userId;
  const now = new Date();

  await this.docRepo.delete({ repoId: In(sharedIds) });

  for (const id of sharedIds) {
    await this.updateSettings(id, {
      docsSyncStatus: 'idle',
      docsSyncMessage: null,
      docsLastGeneratedAt: null,
      docsLastCommitSha: null,
      docsLastSourceSha: null,
      docsSourceCache: null,
      docsDeletedByEmail: email,
      docsDeletedAt: now,
    });
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd tocktest-back
npm run build
```

Expected: `Build successful`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/docs/docs.service.ts
git commit -m "feat(docs): delete docs across all shared repos and record deleter email"
```

---

### Task 5: Update frontend types

**Files:**
- Modify: `tocktest-front/src/types/api/main/docs.ts`
- Modify: `tocktest-front/src/types/app/docs/index.ts`

- [ ] **Step 1: Update `DocVersionResponse` in API types to a discriminated union**

Replace the `DocVersionResponse` interface in `tocktest-front/src/types/api/main/docs.ts`:

```typescript
export type DocVersionResponse =
  | { kind: 'version'; id: string; version: number; updatedAt: string; updatedBy: string | null }
  | { kind: 'deleted'; id: string; email: string; deletedAt: string };
```

Full file after change:

```typescript
export interface ProjectDocResponse {
  id: string;
  repoId: string;
  content: string;
  version: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DocVersionResponse =
  | { kind: 'version'; id: string; version: number; updatedAt: string; updatedBy: string | null }
  | { kind: 'deleted'; id: string; email: string; deletedAt: string };

export interface DocStatusResponse {
  status: "idle" | "queued" | "running" | "success" | "error";
  message: string | null;
  lastGeneratedAt: string | null;
  lastCommitSha: string | null;
  lastSourceSha: string | null;
  autoSync: boolean;
  offlineMode: boolean;
  isStale: boolean;
}
```

- [ ] **Step 2: Update `DocVersion` in app types to match**

Replace the `DocVersion` interface in `tocktest-front/src/types/app/docs/index.ts`:

```typescript
export type DocVersion =
  | { kind: 'version'; id: string; version: number; updatedAt: string; updatedBy: string | null }
  | { kind: 'deleted'; id: string; email: string; deletedAt: string };
```

Full file after change:

```typescript
export interface ProjectDoc {
  id: string;
  repoId: string;
  content: string;
  version: number;
  updatedAt: string;
}

export type DocVersion =
  | { kind: 'version'; id: string; version: number; updatedAt: string; updatedBy: string | null }
  | { kind: 'deleted'; id: string; email: string; deletedAt: string };

export interface DocStatus {
  status: "idle" | "queued" | "running" | "success" | "error";
  message: string | null;
  lastGeneratedAt: string | null;
  lastCommitSha: string | null;
  lastSourceSha: string | null;
  autoSync: boolean;
  offlineMode: boolean;
  isStale: boolean;
}
```

- [ ] **Step 3: Verify frontend TypeScript compiles**

```bash
cd tocktest-front
npx tsc --noEmit
```

Expected: No type errors (there will be errors in `DocsContent.tsx` until Task 6 is done — that's expected).

- [ ] **Step 4: Commit**

```bash
cd tocktest-front
git add src/types/api/main/docs.ts src/types/app/docs/index.ts
git commit -m "feat(docs): update DocVersion to discriminated union with deletion entry"
```

---

### Task 6: Update frontend history panel

**Files:**
- Modify: `tocktest-front/src/components/partials/Docs/DocsContent.tsx`

- [ ] **Step 1: Update the history panel `versions.map` to handle both entry kinds**

In `DocsContent.tsx`, find the `versions.map(...)` block inside the `{showHistory && ...}` section (around lines 329–343) and replace it with:

```tsx
{versions.map((entry) =>
  entry.kind === 'deleted' ? (
    <div key={entry.id} className="relative text-red-500 dark:text-red-400">
      <div className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-red-400" />
      <div className="font-medium text-sm">Deleted</div>
      <div className="text-xs opacity-70">{entry.email}</div>
      <div className="text-xs opacity-70">{dayjs(entry.deletedAt).format("DD/MM/YYYY HH:mm")}</div>
    </div>
  ) : (
    <div
      key={entry.id}
      className={`relative ${entry.version === doc?.version ? "text-indigo-600 dark:text-indigo-400" : "text-muted"}`}
    >
      <div
        className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ${
          entry.version === doc?.version ? "bg-indigo-500" : "bg-gray-300 dark:bg-[#5a5a5a]"
        }`}
      />
      <div className="font-medium text-sm">v{entry.version}</div>
      <div className="text-xs opacity-70">{dayjs(entry.updatedAt).format("DD/MM/YYYY HH:mm")}</div>
    </div>
  )
)}
```

- [ ] **Step 2: Verify frontend TypeScript compiles cleanly**

```bash
cd tocktest-front
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/partials/Docs/DocsContent.tsx
git commit -m "feat(docs): render deletion entries in version history panel"
```

---

## Manual Test Checklist

After all tasks are complete, test with two accounts that have both synced the same GitHub repo:

1. **Account A** — generate docs → docs appear
2. **Account B** (same GitHub repo synced) — navigate to the same repo's Docs page → same docs should now appear
3. **Account B** — click Delete → docs disappear for both accounts
4. **Account A** — open History panel → should see "Deleted" entry with Account B's email
5. **Account A** — generate docs again → docs appear, History panel no longer shows the deletion entry
