import { Injectable, Logger, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Repository } from '../repositories/entities/repository.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { RepoSettings } from '../settings/entities/repo-settings.entity';
import { GithubApiClient } from '../../common/github/github-api.client';
import { GithubCommit, GithubCommitStatusState, GithubPullRequest } from '../../common/github/github-api.types';
import {
  buildTestGenerationPrompt,
  buildCommitAnalysisPrompt,
  buildWhatToTestPrompt,
  buildDocUpdatePrompt,
  buildPullRequestReviewPrompt,
} from './prompts';
import { normalizePriority, normalizeRiskLevel, normalizeTestType } from '../../common/utils/normalize-ai';
import { heuristicAnalyzeCommit, heuristicWhatToTest, heuristicChat } from '../../common/utils/heuristic-ai';
import { getErrorMessage } from '../../common/utils/error.util';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AiExecutionOptions {
  forceOffline?: boolean;
  repoId?: string;
  language?: 'th' | 'en';
}

interface GeneratedTestCase {
  title?: string;
  description?: string;
  steps?: unknown;
  expectedResult?: string;
  testType?: string;
  priority?: string;
  tags?: unknown;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private availCache: { ts: number; ok: boolean } | null = null;
  private readonly AVAIL_TTL_MS = 60_000;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Repository)
    private readonly repoRepo: TypeOrmRepo<Repository>,
    @InjectRepository(RepoSettings)
    private readonly repoSettingsRepo: TypeOrmRepo<RepoSettings>,
    private readonly githubTokensService: GithubTokensService,
    private readonly githubApi: GithubApiClient,
  ) { }

  private get apiUrl(): string {
    return this.config.get<string>('AI_API_URL', 'http://localhost:3009');
  }

  private get openaiApiKey(): string | undefined {
    return this.config.get<string>('OPENAI_API_KEY');
  }

  private get openaiModel(): string {
    return this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
  }

  // ── Core AI chat ──────────────────────────────────────────────────────

  private async isRemoteAiAvailable(): Promise<boolean> {
    if (this.openaiApiKey) return true;
    if (this.availCache && Date.now() - this.availCache.ts < this.AVAIL_TTL_MS) {
      return this.availCache.ok;
    }
    try {
      await axios.get(this.apiUrl, { timeout: 2000, validateStatus: () => true });
      this.availCache = { ts: Date.now(), ok: true };
      return true;
    } catch {
      this.availCache = { ts: Date.now(), ok: false };
      return false;
    }
  }

  async healthCheck(): Promise<{ available: boolean }> {
    // Report the REAL AI service status (not the always-on heuristic fallback)
    return { available: await this.isRemoteAiAvailable() };
  }

  private async shouldUseOfflineMode(options?: AiExecutionOptions): Promise<boolean> {
    if (options?.forceOffline) return true;
    if (!options?.repoId) return false;
    const settings = await this.repoSettingsRepo.findOne({
      where: { repoId: options.repoId },
      select: ['aiOfflineMode'],
    });
    return settings?.aiOfflineMode ?? false;
  }

  async chat(messages: ChatMessage[], options?: AiExecutionOptions): Promise<string> {
    try {
      const res = await axios.post(
        `${this.apiUrl}/chat`,
        { messages, max_tokens: 4096 },
        { timeout: 60000 },
      );
      const content =
        res.data?.choices?.[0]?.message?.content ??
        res.data?.data?.content ??
        res.data?.content ??
        res.data?.response ??
        res.data?.message ??
        '';
      this.logger.debug(`AI response length: ${content.length} chars`);
      return content;
    } catch (err: unknown) {
      this.logger.error(`AI API call failed: ${getErrorMessage(err)}`);
    }
    // Heuristic fallback — uses real repo data from context, no external AI needed
    this.logger.warn('AI offline — using heuristic chat');
    return heuristicChat(messages, options?.language ?? 'th');
  }

  private async openaiChat(messages: ChatMessage[]): Promise<string> {
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model: this.openaiModel, messages, max_tokens: 4096 },
        {
          timeout: 60000,
          headers: { Authorization: `Bearer ${this.openaiApiKey}` },
        },
      );
      const content = res.data?.choices?.[0]?.message?.content ?? '';
      this.logger.debug(`OpenAI response length: ${content.length} chars`);
      return content;
    } catch (err: unknown) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const detail = axios.isAxiosError(err) ? err.response?.data?.error?.message ?? err.message : getErrorMessage(err);
      this.logger.error(`OpenAI API call failed [${status}]: ${detail}`);
      if (status === 401) throw new ServiceUnavailableException('OpenAI API key invalid');
      if (status === 429) throw new ServiceUnavailableException('OpenAI rate limit exceeded');
      throw new InternalServerErrorException('AI request failed');
    }
  }

  parseJson<T>(content: string): T | null {
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, content];
      const jsonStr = (jsonMatch[1] ?? content).trim();
      return JSON.parse(jsonStr) as T;
    } catch {
      this.logger.warn(`Failed to parse AI JSON: ${content.slice(0, 200)}`);
      return null;
    }
  }

  // ── Test Case Generation ──────────────────────────────────────────────

  async generateTestCases(userId: string, repoId: string, params: {
    fromDate?: string;
    toDate?: string;
    commitShas?: string[];
    branch?: string;
  }) {
    const repo = await this.repoRepo.findOne({ where: { id: repoId, userId } });
    if (!repo) throw new NotFoundException('Repository not found');
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('ไม่พบ GitHub Token กรุณาเพิ่มก่อน');
    const diffs = await this.fetchCommitDiffs(repo.fullName, pat, params);
    if (!diffs) {
      throw new InternalServerErrorException('ไม่พบ commit ที่สามารถวิเคราะห์ได้ในช่วงเวลาที่เลือก');
    }
    const projectContext = await this.fetchProjectContext(repo.fullName, pat);
    const mapTestCases = (parsed: GeneratedTestCase[]) =>
      parsed.map((tc) => ({
        title: tc.title ?? '',
        description: tc.description ?? null,
        steps: Array.isArray(tc.steps) ? tc.steps : null,
        expectedResult: tc.expectedResult ?? null,
        testType: normalizeTestType(tc.testType),
        status: 'not_tested',
        priority: normalizePriority(tc.priority),
        tags: Array.isArray(tc.tags) ? tc.tags : [],
        isAiGenerated: true,
        folderId: null,
      }));

    const prompt = buildTestGenerationPrompt(diffs, projectContext || undefined);
    const response = await this.chat([{ role: 'user', content: prompt }], { repoId });
    const parsed = this.parseJson<GeneratedTestCase[]>(response) ?? [];
    if (parsed.length === 0) {
      throw new InternalServerErrorException('AI ไม่สามารถสร้าง test case ได้ กรุณาลองใหม่');
    }

    return {
      testCases: mapTestCases(parsed),
      logId: null,
      model: 'default',
      tokensUsed: 0,
    };
  }

  async fetchProjectContext(fullName: string, pat: string): Promise<string> {
    const files = ['CLAUDE.md', 'README.md'];
    const results = await Promise.all(
      files.map(async (file) => {
        const content = await this.githubApi.getFileText(fullName, file, pat);
        if (content === null) return null;
        return `--- ${file} ---\n${content.slice(0, 3000)}`;
      }),
    );
    return results.filter(Boolean).join('\n\n');
  }

  // ── Commit Analysis ───────────────────────────────────────────────────

  async analyzeCommit(commitData: string, options?: AiExecutionOptions) {
    if (await this.shouldUseOfflineMode(options) || !(await this.isRemoteAiAvailable())) {
      this.logger.warn('AI offline — using heuristic commit analysis');
      return heuristicAnalyzeCommit(commitData);
    }
    const prompt = buildCommitAnalysisPrompt(commitData);
    const response = await this.chat([{ role: 'user', content: prompt }], options);
    const parsed = this.parseJson<{
      summary: string;
      riskLevel: string;
      testSuggestions: string[];
      affectedAreas: string[];
    }>(response);
    const fallback = { summary: response, riskLevel: 'medium' as const, testSuggestions: [] as string[], affectedAreas: [] as string[] };
    const result = parsed ?? fallback;
    return {
      ...result,
      riskLevel: normalizeRiskLevel(result.riskLevel),
      testSuggestions: Array.isArray(result.testSuggestions) ? result.testSuggestions : [],
      affectedAreas: Array.isArray(result.affectedAreas) ? result.affectedAreas : [],
      source: 'ai' as const,
    };
  }

  // ── What To Test ──────────────────────────────────────────────────────

  async getWhatToTest(commitsData: string, options?: AiExecutionOptions) {
    if (await this.shouldUseOfflineMode(options) || !(await this.isRemoteAiAvailable())) {
      this.logger.warn('AI offline — using heuristic what-to-test');
      return heuristicWhatToTest(commitsData);
    }
    const prompt = buildWhatToTestPrompt(commitsData);
    const response = await this.chat([{ role: 'user', content: prompt }], options);
    const parsed = this.parseJson<{
      recommendations: string[];
      priority: string;
      reasoning: string;
    }>(response);
    const fallback = { recommendations: [response], priority: 'medium' as const, reasoning: '' };
    const result = parsed ?? fallback;
    return {
      recommendations: Array.isArray(result.recommendations) ? result.recommendations : [response],
      priority: normalizePriority(result.priority),
      reasoning: result.reasoning ?? '',
      source: 'ai' as const,
    };
  }

  // ── Doc Auto-Update ───────────────────────────────────────────────────

  async autoUpdateDoc(repoInfo: string, existingDoc: string, options?: AiExecutionOptions): Promise<string> {
    const prompt = buildDocUpdatePrompt(repoInfo, existingDoc);
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  async reviewPullRequest(pullRequestData: string, options?: AiExecutionOptions) {
    if (await this.shouldUseOfflineMode(options) || !(await this.isRemoteAiAvailable())) {
      return {
        summary: 'AI service unavailable, so PR review could not be generated.',
        riskLevel: 'medium' as const,
        findings: [],
        mergeRecommendation: 'comment' as const,
        source: 'heuristic' as const,
      };
    }

    const prompt = buildPullRequestReviewPrompt(pullRequestData);
    const response = await this.chat([{ role: 'user', content: prompt }], options);
    const parsed = this.parseJson<{
      summary: string;
      riskLevel: string;
      findings: Array<{
        file?: string;
        severity?: string;
        title?: string;
        comment?: string;
        suggestion?: string;
      }>;
      mergeRecommendation?: string;
    }>(response);
    const result = parsed ?? {
      summary: response,
      riskLevel: 'medium',
      findings: [],
      mergeRecommendation: 'comment',
    };

    return {
      summary: result.summary ?? '',
      riskLevel: normalizeRiskLevel(result.riskLevel),
      findings: Array.isArray(result.findings)
        ? result.findings.map((item) => ({
          file: item.file ?? null,
          severity: normalizeRiskLevel(item.severity),
          title: item.title ?? 'Review finding',
          comment: item.comment ?? '',
          suggestion: item.suggestion ?? '',
        }))
        : [],
      mergeRecommendation:
        result.mergeRecommendation === 'approve' || result.mergeRecommendation === 'request_changes'
          ? result.mergeRecommendation
          : 'comment',
      source: 'ai' as const,
    };
  }

  // ── GitHub helpers ────────────────────────────────────────────────────
  // Thin pass-throughs to GithubApiClient — kept here (rather than called
  // directly by other modules) because callers already depend on AiService
  // and this avoids churning their constructors.

  async fetchCommitDiffs(fullName: string, pat: string, params: {
    fromDate?: string;
    toDate?: string;
    commitShas?: string[];
    branch?: string;
  }): Promise<string | null> {
    try {
      let shas = params.commitShas ?? [];
      if (!shas.length) {
        const commits = await this.githubApi.listCommits(fullName, pat, {
          since: params.fromDate,
          until: params.toDate,
          sha: params.branch,
          per_page: 10,
        });
        shas = commits.map((c) => c.sha);
      }

      const diffs = await Promise.all(
        shas.slice(0, 5).map(async (sha: string) => {
          const diff = await this.githubApi.getCommitDiff(fullName, sha, pat);
          return `--- Commit ${sha} ---\n${diff}`;
        }),
      );
      return diffs.join('\n\n').slice(0, 20000);
    } catch (err: unknown) {
      this.logger.warn(`fetchCommitDiffs error: ${getErrorMessage(err)}`);
      return null;
    }
  }

  async fetchCommits(fullName: string, pat: string, params: {
    since?: string;
    until?: string;
    per_page?: number;
    page?: number;
    branch?: string;
  }): Promise<GithubCommit[]> {
    return this.githubApi.listCommits(fullName, pat, {
      since: params.since,
      until: params.until,
      per_page: params.per_page ?? 30,
      page: params.page ?? 1,
      sha: params.branch,
    });
  }

  async fetchCommitDetail(fullName: string, pat: string, sha: string): Promise<GithubCommit> {
    return this.githubApi.getCommit(fullName, sha, pat);
  }

  async postIssueComment(fullName: string, token: string, issueNumber: number, body: string): Promise<void> {
    await this.githubApi.postIssueComment(fullName, issueNumber, body, token);
  }

  async postCommitStatus(
    fullName: string,
    token: string,
    sha: string,
    state: GithubCommitStatusState,
    description: string,
    context = 'tocktest/ai-review',
  ): Promise<void> {
    await this.githubApi.postCommitStatus(fullName, sha, state, description, token, context);
  }

  async fetchPullRequestDetail(fullName: string, pat: string, prNumber: number): Promise<GithubPullRequest> {
    return this.githubApi.getPullRequestDetail(fullName, prNumber, pat);
  }
}
