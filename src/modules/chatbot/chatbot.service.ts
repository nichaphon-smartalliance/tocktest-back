import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { Repository } from '../repositories/entities/repository.entity';
import { TestCase } from '../test-cases/entities/test-case.entity';
import { CommitAnalysis } from '../analysis/entities/commit-analysis.entity';
import { ProjectDoc } from '../docs/entities/project-doc.entity';
import type { ChatRequestDto } from './dto/chat.dto';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly aiService: AiService,
    @InjectRepository(Repository) private readonly repoRepo: TypeOrmRepo<Repository>,
    @InjectRepository(TestCase) private readonly tcRepo: TypeOrmRepo<TestCase>,
    @InjectRepository(CommitAnalysis) private readonly commitRepo: TypeOrmRepo<CommitAnalysis>,
    @InjectRepository(ProjectDoc) private readonly docRepo: TypeOrmRepo<ProjectDoc>,
  ) {}

  async chat(userId: string, repoId: string, dto: ChatRequestDto) {
    const repo = await this.repoRepo.findOne({ where: { id: repoId, userId } });
    if (!repo) throw new NotFoundException('Repository not found');

    const context = await this.buildContext(repoId, repo.fullName);

    const systemPrompt = `You are a QA assistant for the repository "${repo.fullName}".
You help with test planning, test case design, and quality assurance questions.

Repository context:
${context}

Answer questions accurately and helpfully. If asked to write test code, produce Cypress TypeScript by default.
Keep responses focused and practical. ${dto.language === 'en' ? 'Respond in English only.' : 'Respond in Thai (ภาษาไทย) only.'}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...(dto.history ?? []).slice(-8).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: dto.message },
    ];

    const response = await this.aiService.chat(messages, { repoId });
    return { response, repoId };
  }

  private async buildContext(repoId: string, fullName: string): Promise<string> {
    const parts: string[] = [`Repo: ${fullName}`];

    try {
      const doc = await this.docRepo.findOne({ where: { repoId } });
      if (doc?.content) {
        parts.push(`\n## Project Documentation\n${doc.content.slice(0, 2000)}`);
      }
    } catch { /* ignore */ }

    try {
      const testCases = await this.tcRepo.find({
        where: { repoId },
        order: { createdAt: 'DESC' },
        take: 20,
        select: ['title', 'status', 'priority', 'testType', 'tags'],
      });
      if (testCases.length > 0) {
        const summary = testCases.map((tc) => `- [${tc.status}/${tc.priority}] ${tc.title}`).join('\n');
        parts.push(`\n## Recent Test Cases (${testCases.length} shown)\n${summary}`);
      }
    } catch { /* ignore */ }

    try {
      const commits = await this.commitRepo.find({
        where: { repoId },
        order: { committedAt: 'DESC' },
        take: 5,
        select: ['commitSha', 'commitMessage', 'riskLevel', 'aiSummary'],
      });
      if (commits.length > 0) {
        const summary = commits
          .map((c) => `- [${c.riskLevel ?? 'unknown'} risk] ${c.commitMessage?.slice(0, 80) ?? c.commitSha.slice(0, 7)}${c.aiSummary ? ` — ${c.aiSummary.slice(0, 100)}` : ''}`)
          .join('\n');
        parts.push(`\n## Recent Commits\n${summary}`);
      }
    } catch { /* ignore */ }

    return parts.join('\n');
  }
}
