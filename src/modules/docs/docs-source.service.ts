import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { GithubApiClient } from '../../common/github/github-api.client';
import { SourceTreeItem } from './doc-markdown.util';

export interface BranchHead {
  commitSha: string;
  treeSha: string;
}

/**
 * GitHub source-tree access for the docs generator: branch head, recursive
 * tree, diffed paths between two commits, and raw file content. Split out of
 * DocsService so that orchestration (DocsService) doesn't also own GitHub
 * fetch mechanics.
 */
@Injectable()
export class DocsSourceService {
  constructor(private readonly githubApi: GithubApiClient) {}

  async fetchBranchHead(fullName: string, token: string, branch: string): Promise<BranchHead> {
    const data = await this.githubApi.getBranch(fullName, branch, token);
    return {
      commitSha: data.commit?.sha,
      treeSha: data.commit?.commit?.tree?.sha as string,
    };
  }

  async fetchRepoTree(fullName: string, token: string, treeSha: string): Promise<SourceTreeItem[]> {
    const data = await this.githubApi.getTree(fullName, treeSha, token, true);
    return Array.isArray(data?.tree) ? data.tree : [];
  }

  async fetchChangedPaths(fullName: string, token: string, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const data = await this.githubApi.compareCommits(fullName, base, head, token);
    const files = Array.isArray(data?.files) ? data.files : [];
    return files.map((file) => String(file.filename ?? '')).filter(Boolean);
  }

  async fetchFileContent(fullName: string, token: string, filePath: string, ref: string): Promise<string> {
    const data = await this.githubApi.getFileContent(fullName, filePath, token, ref);
    const encoded = data?.content;
    if (typeof encoded !== 'string') return '';
    return Buffer.from(encoded, 'base64').toString('utf-8');
  }

  describeGenerationError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const responseData = error.response?.data as { message?: unknown } | undefined;
      const apiMessage =
        typeof responseData?.message === 'string'
          ? responseData.message
          : Array.isArray(responseData?.message)
            ? responseData.message.join(', ')
            : null;

      if (status === 401) {
        return 'GitHub token is invalid or expired. Reconnect GitHub and try generating docs again.';
      }
      if (status === 403) {
        return 'GitHub denied access to this repository or rate-limited the request. Check token scopes and repository access.';
      }
      if (status === 404) {
        return 'Repository or branch was not found on GitHub. Check repository access and default branch settings.';
      }
      if (apiMessage) {
        return `GitHub API error: ${apiMessage}`;
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'Documentation generation failed.';
  }
}
