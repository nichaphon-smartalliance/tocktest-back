export interface GithubOwner {
  login: string;
  id: number;
  type?: string;
}

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  owner?: GithubOwner;
}

export interface GithubBranch {
  name: string;
  commit: {
    sha: string;
    commit?: {
      tree?: { sha: string };
    };
  };
}

export interface GithubCommitAuthor {
  name?: string;
  email?: string;
  date?: string;
}

export interface GithubCommitFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
}

export interface GithubCommitStats {
  additions?: number;
  deletions?: number;
  total?: number;
}

export interface GithubCommit {
  sha: string;
  html_url?: string;
  commit: {
    message: string;
    author?: GithubCommitAuthor;
  };
  author?: GithubOwner | null;
  stats?: GithubCommitStats;
  files?: GithubCommitFile[];
}

export interface GithubCompareResult {
  files?: GithubCommitFile[];
}

export interface GithubTreeItem {
  path: string;
  sha: string;
  type: string;
  size?: number;
}

export interface GithubTree {
  tree: GithubTreeItem[];
}

export interface GithubContent {
  content: string;
  encoding: string;
  sha: string;
}

export interface GithubPullRequest {
  number: number;
  title: string;
  state?: string;
  body: string | null;
  html_url?: string;
  changed_files?: number;
  additions?: number;
  deletions?: number;
  user?: GithubOwner;
  base?: { ref: string };
  head?: { ref: string; sha: string };
  files?: GithubCommitFile[];
}

export interface GithubUser {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string;
  email?: string | null;
}

export interface GithubUserEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export type GithubCommitStatusState = 'pending' | 'success' | 'failure' | 'error';

export interface GithubInstallationRepositoriesResponse {
  total_count: number;
  repositories: GithubRepo[];
}
