# Docs Cross-Account Sync Design

**Date:** 2026-06-25  
**Status:** Approved

## Problem

`project_docs` is keyed by `repoId` (a per-user UUID). When two accounts both sync the same GitHub repo, each gets its own `Repository` row with a different `repoId`. Docs generated under one account are invisible to the other because `getLatestDoc` queries `WHERE repoId = :repoId` (single user's ID only).

The backend already solves this for test cases via `RepositoriesService.getSharedRepoIds()`, which finds all `repoId`s sharing the same GitHub `fullName`. The fix applies the same pattern to docs.

## Scope

- **Backend:** `DocsService` + `RepoSettings` entity
- **Frontend:** history panel in `DocsContent.tsx` + `DocVersion` type
- **No new tables. No schema migration on existing tables.**

## Data Model Change

Add two nullable columns to the existing `RepoSettings` entity:

| column | type | purpose |
|---|---|---|
| `docs_deleted_by_email` | varchar, nullable | email of the user who last deleted all docs |
| `docs_deleted_at` | timestamptz, nullable | when the last deletion happened |

These are stamped on **all** shared `RepoSettings` rows when any user deletes docs.

## Backend Changes

### `DocsService`

**`getLatestDoc(userId, repoId)`**
- Call `getSharedRepoIds(userId, repoId)` to get all sibling repoIds
- Query `WHERE repoId IN (sharedIds) ORDER BY version DESC LIMIT 1`

**`getVersions(userId, repoId)`**
- Call `getSharedRepoIds(userId, repoId)`
- Query versions `WHERE repoId IN (sharedIds) ORDER BY version DESC LIMIT 20`
- If any shared `RepoSettings` has `docsDeletedAt` set, append a deletion entry to the response: `{ kind: 'deleted', email, deletedAt }`

**`deleteDoc(userId, repoId)`**
- Call `getSharedRepoIds(userId, repoId)`
- `DELETE WHERE repoId IN (sharedIds)` (was: single repoId)
- Lookup the deleter's email from the `users` table
- Stamp `docsDeletedByEmail` + `docsDeletedAt` on all shared `RepoSettings` rows
- Reset other doc sync columns (`docsSyncStatus: 'idle'`, etc.) on all shared rows — same as before

**`updateDoc(userId, repoId, content)`** — no change; writes to current user's repoId, shared reads pick it up

**`generateInBackground`** — no change; generates under current user's repoId

**`getStatus(userId, repoId)`** — no change; sync state remains per-user

### New dependency

`DocsService` needs to inject `UsersService` (or directly query the users repository) to resolve the deleter's email at delete time.

### `RepoSettings` entity

Add:
```ts
@Column({ name: 'docs_deleted_by_email', nullable: true, type: 'varchar' })
docsDeletedByEmail: string | null;

@Column({ name: 'docs_deleted_at', nullable: true, type: 'timestamptz' })
docsDeletedAt: Date | null;
```

These columns are reset to `null` on **all** shared `RepoSettings` rows whenever docs are successfully generated or updated — so a new generation clears the deletion marker for every account that has the same GitHub repo.

## API Shape

`GET /repositories/:repoId/docs/versions` response changes from:

```ts
{ id: string; version: number; updatedAt: string; updatedBy: string | null }[]
```

to a discriminated union:

```ts
type DocHistoryEntry =
  | { kind: 'version'; id: string; version: number; updatedAt: string; updatedBy: string | null }
  | { kind: 'deleted'; email: string; deletedAt: string }
```

Deletion entry appears at the top of the list (most recent event).

## Frontend Changes

### `DocsContent.tsx` — history panel

- Update rendering to handle `kind === 'deleted'` entries
- Show: **"Deleted by user@email.com"** + formatted date, visually distinct from version entries (e.g. red dot instead of neutral dot)

### Types

- `DocVersion` becomes the `DocHistoryEntry` union above
- Frontend `useProjectDoc` hook already handles the versions query — no hook changes needed

## Out of Scope

- Per-version "updated by" email display (only deletion events show email)
- Multiple deletion history (only the most recent deletion is stored)
- Generating docs on behalf of another user's repoId
