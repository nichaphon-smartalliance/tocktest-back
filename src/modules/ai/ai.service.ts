import { Injectable, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Repository } from '../repositories/entities/repository.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import {
  buildTestGenerationPrompt,
  buildCommitAnalysisPrompt,
  buildWhatToTestPrompt,
  buildDocUpdatePrompt,
  buildPullRequestReviewPrompt,
} from './prompts';
import { normalizePriority, normalizeRiskLevel, normalizeTestType } from '../../common/utils/normalize-ai';
import { heuristicAnalyzeCommit, heuristicGenerateTestCases, heuristicWhatToTest } from '../../common/utils/heuristic-ai';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
    private readonly githubTokensService: GithubTokensService,
  ) {}

  private get apiUrl(): string {
    return this.config.get<string>('AI_API_URL', 'http://localhost:3009');
  }

  // ── Core AI chat ──────────────────────────────────────────────────────

  /** Cached probe — avoids repeated 3s timeouts when AI is down. */
  async isAvailable(): Promise<boolean> {
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
    return { available: await this.isAvailable() };
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new InternalServerErrorException('AI service unavailable');
    }
    try {
      const res = await axios.post(
        `${this.apiUrl}/chat`,
        { messages, max_tokens: 4096 },
        { timeout: 60000 },
      );
      // Support both OpenAI format and AI API Center envelope { success, data: { content } }
      const content =
        res.data?.choices?.[0]?.message?.content ??
        res.data?.data?.content ??
        res.data?.content ??
        res.data?.response ??
        res.data?.message ??
        '';
      this.logger.debug(`AI response length: ${content.length} chars`);
      return content;
    } catch (err: any) {
      this.logger.error(`AI API call failed: ${err.message}`);
      throw new InternalServerErrorException('AI service unavailable');
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
  }) {
    const repo = await this.repoRepo.findOne({ where: { id: repoId, userId } });
    if (!repo) throw new NotFoundException('Repository not found');
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('ไม่พบ GitHub Token กรุณาเพิ่มก่อน');
    const diffs = await this.fetchCommitDiffs(repo.fullName, pat, params);
    if (!diffs) {
      throw new InternalServerErrorException('ไม่พบ commit ที่สามารถวิเคราะห์ได้ในช่วงเวลาที่เลือก');
    }
    const mapTestCases = (parsed: any[]) =>
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

    if (!(await this.isAvailable())) {
      this.logger.warn('AI offline — using heuristic test case generation');
      const testCases = heuristicGenerateTestCases(diffs);
      return { testCases, logId: null, model: 'heuristic', tokensUsed: 0 };
    }

    const prompt = buildTestGenerationPrompt(diffs);
    const response = await this.chat([{ role: 'user', content: prompt }]);
    const parsed = this.parseJson<any[]>(response) ?? [];
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

  // ── Commit Analysis ───────────────────────────────────────────────────

  async analyzeCommit(commitData: string) {
    if (!(await this.isAvailable())) {
      this.logger.warn('AI offline — using heuristic commit analysis');
      return heuristicAnalyzeCommit(commitData);
    }
    const prompt = buildCommitAnalysisPrompt(commitData);
    const response = await this.chat([{ role: 'user', content: prompt }]);
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

  async getWhatToTest(commitsData: string) {
    if (!(await this.isAvailable())) {
      this.logger.warn('AI offline — using heuristic what-to-test');
      return heuristicWhatToTest(commitsData);
    }
    const prompt = buildWhatToTestPrompt(commitsData);
    const response = await this.chat([{ role: 'user', content: prompt }]);
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

  async autoUpdateDoc(repoInfo: string, existingDoc: string): Promise<string> {
    const prompt = buildDocUpdatePrompt(repoInfo, existingDoc);
    return this.chat([{ role: 'user', content: prompt }]);
  }

  async reviewPullRequest(pullRequestData: string) {
    if (!(await this.isAvailable())) {
      return {
        summary: 'AI service unavailable, so PR review could not be generated.',
        riskLevel: 'medium' as const,
        findings: [],
        mergeRecommendation: 'comment' as const,
        source: 'heuristic' as const,
      };
    }

    const prompt = buildPullRequestReviewPrompt(pullRequestData);
    const response = await this.chat([{ role: 'user', content: prompt }]);
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

  async fetchCommitDiffs(fullName: string, pat: string, params: {
    fromDate?: string;
    toDate?: string;
    commitShas?: string[];
  }): Promise<string | null> {
    try {
      let shas = params.commitShas ?? [];
      if (!shas.length) {
        const res = await axios.get(`https://api.github.com/repos/${fullName}/commits`, {
          headers: { Authorization: `token ${pat}` },
          params: { since: params.fromDate, until: params.toDate, per_page: 10 },
          timeout: 10000,
        });
        shas = res.data.map((c: any) => c.sha);
      }

      const diffs: string[] = [];
      for (const sha of shas.slice(0, 5)) {
        const res = await axios.get(
          `https://api.github.com/repos/${fullName}/commits/${sha}`,
          { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3.diff' }, timeout: 10000 },
        );
        diffs.push(`--- Commit ${sha} ---\n${res.data}`);
      }
      return diffs.join('\n\n').slice(0, 20000);
    } catch (err: any) {
      this.logger.warn(`fetchCommitDiffs error: ${err.message}`);
      return null;
    }
  }

  async fetchCommits(fullName: string, pat: string, params: {
    since?: string;
    until?: string;
    per_page?: number;
    page?: number;
    branch?: string;
  }): Promise<any[]> {
    const query: any = { per_page: params.per_page ?? 30, page: params.page ?? 1, since: params.since, until: params.until };
    if (params.branch) query.sha = params.branch;

    const res = await axios.get(`https://api.github.com/repos/${fullName}/commits`, {
      headers: { Authorization: `token ${pat}` },
      params: query,
    });
    return res.data;
  }

  async fetchCommitDetail(fullName: string, pat: string, sha: string): Promise<any> {
    const res = await axios.get(`https://api.github.com/repos/${fullName}/commits/${sha}`, {
      headers: { Authorization: `token ${pat}` },
    });
    return res.data;
  }

  async fetchPullRequestDetail(fullName: string, pat: string, prNumber: number): Promise<any> {
    const [prRes, filesRes] = await Promise.all([
      axios.get(`https://api.github.com/repos/${fullName}/pulls/${prNumber}`, {
        headers: { Authorization: `token ${pat}` },
      }),
      axios.get(`https://api.github.com/repos/${fullName}/pulls/${prNumber}/files`, {
        headers: { Authorization: `token ${pat}` },
        params: { per_page: 50 },
      }),
    ]);

    return {
      ...prRes.data,
      files: filesRes.data,
    };
  }
}
