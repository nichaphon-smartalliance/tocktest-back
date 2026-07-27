import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import {
  encodeRepoPath,
  isValidCommitSha,
  isValidGitRef,
  isValidNumericId,
  isValidRepoFullName,
} from '../utils/github.util';
import {
  GithubBranch,
  GithubCommit,
  GithubCommitStatusState,
  GithubCompareResult,
  GithubContent,
  GithubInstallationRepositoriesResponse,
  GithubPullRequest,
  GithubRepo,
  GithubTree,
  GithubUser,
  GithubUserEmail,
} from './github-api.types';

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_DEFAULT_TIMEOUT_MS = 10_000;
export const GITHUB_LONG_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;

function tokenHeaders(token: string, accept = 'application/vnd.github+json') {
  return { Authorization: `token ${token}`, Accept: accept };
}

// ── URL-segment guards ──────────────────────────────────────────────────────
// Every value interpolated into a GitHub API path is validated HERE rather than
// (only) at the controller/DTO layer. This is the single choke point every
// caller funnels through, so a new caller cannot reintroduce path traversal by
// forgetting a DTO constraint. Failures are BadRequest, never a silent request
// to an unintended endpoint.

function assertRepoFullName(fullName: string): string {
  if (!isValidRepoFullName(fullName)) {
    throw new BadRequestException('Invalid repository name');
  }
  return fullName;
}

function assertCommitSha(sha: string): string {
  if (!isValidCommitSha(sha)) {
    throw new BadRequestException('Invalid commit SHA');
  }
  return sha;
}

function assertGitRef(ref: string): string {
  if (!isValidGitRef(ref)) {
    throw new BadRequestException('Invalid git ref');
  }
  return ref;
}

function assertNumericId(value: number | string, label: string): string {
  const asString = String(value);
  if (!isValidNumericId(asString)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return asString;
}

/**
 * Thin, typed wrapper around the GitHub REST API for PAT/installation-token
 * authenticated calls. Centralizes base URL, headers and timeouts that were
 * previously duplicated across ai/docs/repositories/github-tokens/github-app
 * services. GitHub App JWT auth and OAuth code exchange stay in their own
 * services (different auth mechanism), but funnel through this client's
 * token-authenticated methods once they have a token in hand.
 */
@Injectable()
export class GithubApiClient {
  /**
   * `type` filters to repos owned by the token holder ('owner') vs every repo
   * they can see, including org/collaborator repos (omit it). Callers differ
   * on this intentionally — keep passing it through rather than hardcoding.
   */
  async listUserRepos(token: string, page: number, type?: 'owner', perPage = PAGE_SIZE): Promise<GithubRepo[]> {
    const res = await axios.get<GithubRepo[]>(`${GITHUB_API_BASE}/user/repos`, {
      headers: tokenHeaders(token),
      params: { per_page: perPage, page, sort: 'updated', ...(type ? { type } : {}) },
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  /** Paginates through all repos visible to the token (see listUserRepos re: `type`). */
  async listAllUserRepos(token: string, type?: 'owner'): Promise<GithubRepo[]> {
    const all: GithubRepo[] = [];
    let page = 1;
    while (true) {
      const batch = await this.listUserRepos(token, page, type);
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      page++;
    }
    return all;
  }

  async listBranches(fullName: string, token: string, page: number, perPage = PAGE_SIZE): Promise<GithubBranch[]> {
    const res = await axios.get<GithubBranch[]>(`${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/branches`, {
      headers: tokenHeaders(token),
      params: { per_page: perPage, page },
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  /** Paginates through all branches of a repo. */
  async listAllBranches(fullName: string, token: string): Promise<GithubBranch[]> {
    const all: GithubBranch[] = [];
    let page = 1;
    while (true) {
      const batch = await this.listBranches(fullName, token, page);
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      page++;
    }
    return all;
  }

  async getBranch(fullName: string, branch: string, token: string): Promise<GithubBranch> {
    const res = await axios.get<GithubBranch>(
      `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/branches/${encodeURIComponent(assertGitRef(branch))}`,
      { headers: tokenHeaders(token), timeout: GITHUB_DEFAULT_TIMEOUT_MS },
    );
    return res.data;
  }

  async listCommits(
    fullName: string,
    token: string,
    params: { since?: string; until?: string; sha?: string; per_page?: number; page?: number } = {},
  ): Promise<GithubCommit[]> {
    const res = await axios.get<GithubCommit[]>(`${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/commits`, {
      headers: tokenHeaders(token),
      params,
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  async getCommit(fullName: string, sha: string, token: string): Promise<GithubCommit> {
    const url = `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/commits/${assertCommitSha(sha)}`;
    const res = await axios.get<GithubCommit>(url, {
      headers: tokenHeaders(token),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  /** Same endpoint as getCommit, requested as a unified diff instead of JSON. */
  async getCommitDiff(fullName: string, sha: string, token: string): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/commits/${assertCommitSha(sha)}`;
    const res = await axios.get<string>(url, {
      headers: tokenHeaders(token, 'application/vnd.github.v3.diff'),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  async compareCommits(fullName: string, base: string, head: string, token: string): Promise<GithubCompareResult> {
    const range = `${assertGitRef(base)}...${assertGitRef(head)}`;
    const res = await axios.get<GithubCompareResult>(
      `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/compare/${range}`,
      { headers: tokenHeaders(token), timeout: GITHUB_LONG_TIMEOUT_MS },
    );
    return res.data;
  }

  async getTree(fullName: string, treeSha: string, token: string, recursive = true): Promise<GithubTree> {
    const url = `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/git/trees/${assertCommitSha(treeSha)}`;
    const res = await axios.get<GithubTree>(url, {
      headers: tokenHeaders(token),
      params: recursive ? { recursive: 1 } : undefined,
      timeout: GITHUB_LONG_TIMEOUT_MS,
    });
    return res.data;
  }

  async getFileContent(fullName: string, path: string, token: string, ref?: string): Promise<GithubContent> {
    // `path` comes from the repo's own git tree and may contain characters that
    // are legal in a filename but structural in a URL — encode it per segment.
    const res = await axios.get<GithubContent>(
      `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/contents/${encodeRepoPath(path)}`,
      { headers: tokenHeaders(token), params: ref ? { ref } : undefined, timeout: GITHUB_LONG_TIMEOUT_MS },
    );
    return res.data;
  }

  /** Convenience: fetches and base64-decodes a file, or null if unreachable (404/etc). */
  async getFileText(fullName: string, path: string, token: string, ref?: string): Promise<string | null> {
    try {
      const file = await this.getFileContent(fullName, path, token, ref);
      if (typeof file.content !== 'string') return null;
      return Buffer.from(file.content, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  async getPullRequest(fullName: string, prNumber: number, token: string): Promise<GithubPullRequest> {
    const url = `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/pulls/${assertNumericId(prNumber, 'pull request number')}`;
    const res = await axios.get<GithubPullRequest>(url, {
      headers: tokenHeaders(token),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  async getPullRequestFiles(fullName: string, prNumber: number, token: string, perPage = 50) {
    const url = `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/pulls/${assertNumericId(prNumber, 'pull request number')}/files`;
    const res = await axios.get<NonNullable<GithubPullRequest['files']>>(url, {
      headers: tokenHeaders(token),
      params: { per_page: perPage },
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  /** Fetches a PR plus its changed files merged into one object (`files`). */
  async getPullRequestDetail(fullName: string, prNumber: number, token: string): Promise<GithubPullRequest> {
    const [pr, files] = await Promise.all([
      this.getPullRequest(fullName, prNumber, token),
      this.getPullRequestFiles(fullName, prNumber, token),
    ]);
    return { ...pr, files };
  }

  async postIssueComment(fullName: string, issueNumber: number, body: string, token: string): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/issues/${assertNumericId(issueNumber, 'issue number')}/comments`;
    await axios.post(url, { body }, { headers: tokenHeaders(token), timeout: GITHUB_DEFAULT_TIMEOUT_MS });
  }

  async postCommitStatus(
    fullName: string,
    sha: string,
    state: GithubCommitStatusState,
    description: string,
    token: string,
    context = 'tocktest/ai-review',
  ): Promise<void> {
    await axios.post(
      `${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}/statuses/${assertCommitSha(sha)}`,
      { state, description: description.slice(0, 140), context },
      { headers: tokenHeaders(token), timeout: GITHUB_DEFAULT_TIMEOUT_MS },
    );
  }

  async getRepo(fullName: string, token: string): Promise<GithubRepo> {
    const res = await axios.get<GithubRepo>(`${GITHUB_API_BASE}/repos/${assertRepoFullName(fullName)}`, {
      headers: tokenHeaders(token),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  /** Repos accessible to a GitHub App installation token. */
  async listInstallationRepositories(token: string, perPage = PAGE_SIZE): Promise<GithubRepo[]> {
    const res = await axios.get<GithubInstallationRepositoriesResponse>(
      `${GITHUB_API_BASE}/installation/repositories`,
      { headers: tokenHeaders(token), params: { per_page: perPage }, timeout: GITHUB_DEFAULT_TIMEOUT_MS },
    );
    return res.data?.repositories ?? [];
  }

  /**
   * Asks GitHub whether `accessToken` was issued to THIS OAuth app.
   *
   * `GET /user` accepts any valid GitHub token from any app, so it proves only
   * that a token is live — never that it was minted for us. Without this check a
   * token leaked from (or phished by) an unrelated OAuth app can be replayed at
   * /auth/github to log in as its owner. Returns false on any non-200.
   */
  async checkOAuthTokenBelongsToApp(
    clientId: string,
    clientSecret: string,
    accessToken: string,
  ): Promise<boolean> {
    try {
      const res = await axios.post(
        `${GITHUB_API_BASE}/applications/${encodeURIComponent(clientId)}/token`,
        { access_token: accessToken },
        {
          auth: { username: clientId, password: clientSecret },
          headers: { Accept: 'application/vnd.github+json' },
          timeout: GITHUB_DEFAULT_TIMEOUT_MS,
          validateStatus: () => true,
        },
      );
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Installations of this GitHub App that the *token holder* can access.
   * Used to prove a user actually controls an installation before the backend
   * binds it to their account (see GithubAppService.handleInstallationCallback).
   */
  async listInstallationsForUser(token: string, perPage = PAGE_SIZE): Promise<{ id: number }[]> {
    const res = await axios.get<{ installations?: { id: number }[] }>(
      `${GITHUB_API_BASE}/user/installations`,
      { headers: tokenHeaders(token), params: { per_page: perPage }, timeout: GITHUB_DEFAULT_TIMEOUT_MS },
    );
    return res.data?.installations ?? [];
  }

  async getUser(token: string): Promise<GithubUser> {
    const res = await axios.get<GithubUser>(`${GITHUB_API_BASE}/user`, {
      headers: tokenHeaders(token),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  async getUserEmails(token: string): Promise<GithubUserEmail[]> {
    const res = await axios.get<GithubUserEmail[]>(`${GITHUB_API_BASE}/user/emails`, {
      headers: tokenHeaders(token),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }
}
