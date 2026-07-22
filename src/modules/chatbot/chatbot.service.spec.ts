import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatbotService } from './chatbot.service';
import { AiService } from '../ai/ai.service';
import { Repository } from '../repositories/entities/repository.entity';
import { TestCase } from '../test-cases/entities/test-case.entity';
import { CommitAnalysis } from '../analysis/entities/commit-analysis.entity';
import { ProjectDoc } from '../docs/entities/project-doc.entity';
import type { ChatRequestDto } from './dto/chat.dto';

const mockRepoRow = (overrides = {}) => ({
  id: 'repo-1',
  userId: 'user-a',
  fullName: 'owner/my-repo',
  ...overrides,
});

describe('ChatbotService', () => {
  let service: ChatbotService;
  let aiService: { chat: jest.Mock };
  let repoRepo: { findOne: jest.Mock };
  let tcRepo: { find: jest.Mock };
  let commitRepo: { find: jest.Mock };
  let docRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    aiService = { chat: jest.fn().mockResolvedValue('AI response text') };
    repoRepo = { findOne: jest.fn().mockResolvedValue(mockRepoRow()) };
    tcRepo = { find: jest.fn().mockResolvedValue([]) };
    commitRepo = { find: jest.fn().mockResolvedValue([]) };
    docRepo = { findOne: jest.fn().mockResolvedValue(null) };

    const module = await Test.createTestingModule({
      providers: [
        ChatbotService,
        { provide: AiService, useValue: aiService },
        { provide: getRepositoryToken(Repository), useValue: repoRepo },
        { provide: getRepositoryToken(TestCase), useValue: tcRepo },
        { provide: getRepositoryToken(CommitAnalysis), useValue: commitRepo },
        { provide: getRepositoryToken(ProjectDoc), useValue: docRepo },
      ],
    }).compile();

    service = module.get(ChatbotService);
  });

  const dto = (overrides: Partial<ChatRequestDto> = {}): ChatRequestDto => ({
    message: 'How do I test the login page?',
    ...overrides,
  });

  // ── main chat flow ────────────────────────────────────────────────────────

  describe('chat — happy path', () => {
    it('scopes the repo lookup to id and userId', async () => {
      await service.chat('user-a', 'repo-1', dto());
      expect(repoRepo.findOne).toHaveBeenCalledWith({ where: { id: 'repo-1', userId: 'user-a' } });
    });

    it('returns the AI response together with the repoId', async () => {
      const result = await service.chat('user-a', 'repo-1', dto());
      expect(result).toEqual({ response: 'AI response text', repoId: 'repo-1' });
    });

    it('throws NotFoundException when the repo does not belong to the user', async () => {
      repoRepo.findOne.mockResolvedValue(null);
      await expect(service.chat('user-b', 'repo-1', dto())).rejects.toThrow(NotFoundException);
      expect(aiService.chat).not.toHaveBeenCalled();
    });

    it('passes a system + history + user message array to AiService.chat', async () => {
      await service.chat('user-a', 'repo-1', dto({
        history: [
          { role: 'user', content: 'previous q' },
          { role: 'assistant', content: 'previous a' },
        ],
      }));

      const [messages] = aiService.chat.mock.calls[0];
      expect(messages[0].role).toBe('system');
      expect(messages[messages.length - 1]).toEqual({
        role: 'user',
        content: expect.stringContaining('How do I test the login page?'),
      });
      expect(messages.some((m: any) => m.content === 'previous q')).toBe(true);
    });

    it('only keeps the last 8 history messages', async () => {
      const history = Array.from({ length: 12 }, (_, i) => ({
        role: 'user' as const,
        content: `msg-${i}`,
      }));
      await service.chat('user-a', 'repo-1', dto({ history }));

      const [messages] = aiService.chat.mock.calls[0];
      // messages = [system, ...last 8 history, current user message]
      expect(messages).toHaveLength(1 + 8 + 1);
      expect(messages[1].content).toBe('msg-4');
      expect(messages[messages.length - 2].content).toBe('msg-11');
    });

    it('passes repoId and language through as AI execution options', async () => {
      await service.chat('user-a', 'repo-1', dto({ language: 'en' }));
      expect(aiService.chat).toHaveBeenCalledWith(expect.any(Array), { repoId: 'repo-1', language: 'en' });
    });

    it('directs the AI to answer in English when language is en', async () => {
      await service.chat('user-a', 'repo-1', dto({ language: 'en' }));
      const [messages] = aiService.chat.mock.calls[0];
      expect(messages[0].content).toContain('Reply ONLY in English');
    });

    it('directs the AI to answer in Thai when language is not en', async () => {
      await service.chat('user-a', 'repo-1', dto({ language: 'th' }));
      const [messages] = aiService.chat.mock.calls[0];
      expect(messages[0].content).toContain('ตอบเป็นภาษาไทยเท่านั้น');
    });
  });

  // ── AI backend unavailable / offline fallback ───────────────────────────────
  //
  // ChatbotService itself has no offline branch — AiService.chat() internally
  // catches network failures and resolves with a heuristic answer instead of
  // rejecting (see ai.service.ts). From ChatbotService's point of view "AI is
  // offline" just means aiService.chat() resolves with heuristic-style text,
  // so we simulate that and confirm the fallback text is passed through as-is.

  describe('chat — AI backend offline (heuristic fallback)', () => {
    it('returns whatever AiService.chat resolves with, even a heuristic fallback string', async () => {
      aiService.chat.mockResolvedValue('[heuristic] Based on repo context, consider testing the login flow.');

      const result = await service.chat('user-a', 'repo-1', dto());

      expect(result).toEqual({
        response: '[heuristic] Based on repo context, consider testing the login flow.',
        repoId: 'repo-1',
      });
    });

    it('does not throw or alter behaviour when AiService.chat is the offline heuristic path', async () => {
      aiService.chat.mockResolvedValue('offline fallback answer');
      await expect(service.chat('user-a', 'repo-1', dto())).resolves.toBeDefined();
    });
  });

  // ── context building ─────────────────────────────────────────────────────

  describe('buildContext (via chat)', () => {
    it('includes project doc content when present', async () => {
      docRepo.findOne.mockResolvedValue({ content: 'Docs about the project.' });
      await service.chat('user-a', 'repo-1', dto());
      const [messages] = aiService.chat.mock.calls[0];
      expect(messages[0].content).toContain('Project Documentation');
      expect(messages[0].content).toContain('Docs about the project.');
    });

    it('includes recent test case titles when present', async () => {
      tcRepo.find.mockResolvedValue([
        { title: 'Login works', status: 'pass', priority: 'high', testType: 'ui', tags: [] },
      ]);
      await service.chat('user-a', 'repo-1', dto());
      const [messages] = aiService.chat.mock.calls[0];
      expect(messages[0].content).toContain('Recent Test Cases');
      expect(messages[0].content).toContain('Login works');
    });

    it('includes recent commit summaries when present', async () => {
      commitRepo.find.mockResolvedValue([
        { commitSha: 'abc1234', commitMessage: 'fix bug', riskLevel: 'low', aiSummary: 'Fixed a null check' },
      ]);
      await service.chat('user-a', 'repo-1', dto());
      const [messages] = aiService.chat.mock.calls[0];
      expect(messages[0].content).toContain('Recent Commits');
      expect(messages[0].content).toContain('fix bug');
    });

    it('still succeeds when doc/test-case/commit lookups throw (errors are swallowed)', async () => {
      docRepo.findOne.mockRejectedValue(new Error('db down'));
      tcRepo.find.mockRejectedValue(new Error('db down'));
      commitRepo.find.mockRejectedValue(new Error('db down'));

      const result = await service.chat('user-a', 'repo-1', dto());
      expect(result.response).toBe('AI response text');
    });

    it('falls back to just the repo name when there is no doc, test cases, or commits', async () => {
      await service.chat('user-a', 'repo-1', dto());
      const [messages] = aiService.chat.mock.calls[0];
      expect(messages[0].content).toContain('Repo: owner/my-repo');
    });
  });
});
