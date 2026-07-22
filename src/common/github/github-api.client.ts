import { Injectable } from '@nestjs/common';
import axios from 'axios';
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
    const res = await axios.get<GithubBranch[]>(`${GITHUB_API_BASE}/repos/${fullName}/branches`, {
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
      `${GITHUB_API_BASE}/repos/${fullName}/branches/${encodeURIComponent(branch)}`,
      { headers: tokenHeaders(token), timeout: GITHUB_DEFAULT_TIMEOUT_MS },
    );
    return res.data;
  }

  async listCommits(
    fullName: string,
    token: string,
    params: { since?: string; until?: string; sha?: string; per_page?: number; page?: number } = {},
  ): Promise<GithubCommit[]> {
    const res = await axios.get<GithubCommit[]>(`${GITHUB_API_BASE}/repos/${fullName}/commits`, {
      headers: tokenHeaders(token),
      params,
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  async getCommit(fullName: string, sha: string, token: string): Promise<GithubCommit> {
    const res = await axios.get<GithubCommit>(`${GITHUB_API_BASE}/repos/${fullName}/commits/${sha}`, {
      headers: tokenHeaders(token),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  /** Same endpoint as getCommit, requested as a unified diff instead of JSON. */
  async getCommitDiff(fullName: string, sha: string, token: string): Promise<string> {
    const res = await axios.get<string>(`${GITHUB_API_BASE}/repos/${fullName}/commits/${sha}`, {
      headers: tokenHeaders(token, 'application/vnd.github.v3.diff'),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  async compareCommits(fullName: string, base: string, head: string, token: string): Promise<GithubCompareResult> {
    const res = await axios.get<GithubCompareResult>(
      `${GITHUB_API_BASE}/repos/${fullName}/compare/${base}...${head}`,
      { headers: tokenHeaders(token), timeout: GITHUB_LONG_TIMEOUT_MS },
    );
    return res.data;
  }

  async getTree(fullName: string, treeSha: string, token: string, recursive = true): Promise<GithubTree> {
    const res = await axios.get<GithubTree>(`${GITHUB_API_BASE}/repos/${fullName}/git/trees/${treeSha}`, {
      headers: tokenHeaders(token),
      params: recursive ? { recursive: 1 } : undefined,
      timeout: GITHUB_LONG_TIMEOUT_MS,
    });
    return res.data;
  }

  async getFileContent(fullName: string, path: string, token: string, ref?: string): Promise<GithubContent> {
    const res = await axios.get<GithubContent>(
      `${GITHUB_API_BASE}/repos/${fullName}/contents/${path}`,
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
    const res = await axios.get<GithubPullRequest>(`${GITHUB_API_BASE}/repos/${fullName}/pulls/${prNumber}`, {
      headers: tokenHeaders(token),
      timeout: GITHUB_DEFAULT_TIMEOUT_MS,
    });
    return res.data;
  }

  async getPullRequestFiles(fullName: string, prNumber: number, token: string, perPage = 50) {
    const res = await axios.get<NonNullable<GithubPullRequest['files']>>(
      `${GITHUB_API_BASE}/repos/${fullName}/pulls/${prNumber}/files`,
      { headers: tokenHeaders(token), params: { per_page: perPage }, timeout: GITHUB_DEFAULT_TIMEOUT_MS },
    );
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
    await axios.post(
      `${GITHUB_API_BASE}/repos/${fullName}/issues/${issueNumber}/comments`,
      { body },
      { headers: tokenHeaders(token), timeout: GITHUB_DEFAULT_TIMEOUT_MS },
    );
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
      `${GITHUB_API_BASE}/repos/${fullName}/statuses/${sha}`,
      { state, description: description.slice(0, 140), context },
      { headers: tokenHeaders(token), timeout: GITHUB_DEFAULT_TIMEOUT_MS },
    );
  }

  async getRepo(fullName: string, token: string): Promise<GithubRepo> {
    const res = await axios.get<GithubRepo>(`${GITHUB_API_BASE}/repos/${fullName}`, {
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
