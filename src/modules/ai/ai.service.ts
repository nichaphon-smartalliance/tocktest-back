import { Injectable, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Repository } from '../repositories/entities/repository.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { buildTestGenerationPrompt, buildCommitAnalysisPrompt, buildWhatToTestPrompt, buildDocUpdatePrompt } from './prompts';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

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

  async chat(messages: ChatMessage[]): Promise<string> {
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
      return { testCases: [], logId: null, model: 'default', tokensUsed: 0 };
    }

    const prompt = buildTestGenerationPrompt(diffs);
    const response = await this.chat([{ role: 'user', content: prompt }]);
    const parsed = this.parseJson<any[]>(response) ?? [];

    return {
      testCases: parsed.map((tc) => ({
        title: tc.title ?? '',
        description: tc.description ?? null,
        steps: Array.isArray(tc.steps) ? tc.steps : null,
        expectedResult: tc.expectedResult ?? null,
        testType: tc.testType ?? 'manual',
        status: 'not_tested',
        priority: tc.priority ?? 'medium',
        tags: Array.isArray(tc.tags) ? tc.tags : [],
        isAiGenerated: true,
        folderId: null,
      })),
      logId: null,
      model: 'default',
      tokensUsed: 0,
    };
  }

  // ── Commit Analysis ───────────────────────────────────────────────────

  async analyzeCommit(commitData: string) {
    const prompt = buildCommitAnalysisPrompt(commitData);
    const response = await this.chat([{ role: 'user', content: prompt }]);
    return this.parseJson<{
      summary: string;
      riskLevel: string;
      testSuggestions: string[];
      affectedAreas: string[];
    }>(response) ?? { summary: response, riskLevel: 'medium', testSuggestions: [], affectedAreas: [] };
  }

  // ── What To Test ──────────────────────────────────────────────────────

  async getWhatToTest(commitsData: string) {
    const prompt = buildWhatToTestPrompt(commitsData);
    const response = await this.chat([{ role: 'user', content: prompt }]);
    return this.parseJson<{
      recommendations: string[];
      priority: string;
      reasoning: string;
    }>(response) ?? { recommendations: [response], priority: 'medium', reasoning: '' };
  }

  // ── Doc Auto-Update ───────────────────────────────────────────────────

  async autoUpdateDoc(repoInfo: string, existingDoc: string): Promise<string> {
    const prompt = buildDocUpdatePrompt(repoInfo, existingDoc);
    return this.chat([{ role: 'user', content: prompt }]);
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
        });
        shas = res.data.map((c: any) => c.sha);
      }

      const diffs: string[] = [];
      for (const sha of shas.slice(0, 5)) {
        const res = await axios.get(
          `https://api.github.com/repos/${fullName}/commits/${sha}`,
          { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3.diff' } },
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
  }): Promise<any[]> {
    const res = await axios.get(`https://api.github.com/repos/${fullName}/commits`, {
      headers: { Authorization: `token ${pat}` },
      params: { per_page: params.per_page ?? 30, page: params.page ?? 1, since: params.since, until: params.until },
    });
    return res.data;
  }

  async fetchCommitDetail(fullName: string, pat: string, sha: string): Promise<any> {
    const res = await axios.get(`https://api.github.com/repos/${fullName}/commits/${sha}`, {
      headers: { Authorization: `token ${pat}` },
    });
    return res.data;
  }
}
