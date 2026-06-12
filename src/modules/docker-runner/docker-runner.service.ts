import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TestRun } from './entities/test-run.entity';
import { Repository } from '../repositories/entities/repository.entity';
import type { RunTestsDto } from './dto/run-tests.dto';

const execAsync = promisify(exec);

const DOCKER_IMAGES: Record<string, string> = {
  playwright: 'mcr.microsoft.com/playwright:v1.44.0-jammy',
  cypress: 'cypress/included:13.6.4',
};

@Injectable()
export class DockerRunnerService {
  private readonly logger = new Logger(DockerRunnerService.name);

  constructor(
    @InjectRepository(TestRun) private readonly runRepo: TypeOrmRepo<TestRun>,
    @InjectRepository(Repository) private readonly repoRepo: TypeOrmRepo<Repository>,
  ) {}

  async isDockerAvailable(): Promise<boolean> {
    try {
      await execAsync('docker info', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async enqueueRun(userId: string, repoId: string, dto: RunTestsDto): Promise<TestRun> {
    const repo = await this.repoRepo.findOne({ where: { id: repoId, userId } });
    if (!repo) throw new NotFoundException('Repository not found');

    const run = this.runRepo.create({
      repoId,
      userId,
      framework: dto.framework ?? 'playwright',
      fileContent: dto.fileContent,
      status: 'queued',
    });
    const saved = await this.runRepo.save(run);

    // Run async — don't await
    void this.executeRun(saved.id).catch((err) => {
      this.logger.error(`Test run ${saved.id} crashed: ${err.message}`);
    });

    return saved;
  }

  async getRunStatus(userId: string, runId: string): Promise<TestRun> {
    const run = await this.runRepo.findOne({ where: { id: runId, userId } });
    if (!run) throw new NotFoundException('Test run not found');
    return run;
  }

  async listRuns(userId: string, repoId: string, limit = 20): Promise<TestRun[]> {
    return this.runRepo.find({
      where: { userId, repoId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  private async executeRun(runId: string): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) return;

    const available = await this.isDockerAvailable();
    if (!available) {
      await this.runRepo.update(runId, {
        status: 'error',
        errorMessage: 'Docker is not available on this server. Install Docker to enable sandbox execution.',
      });
      return;
    }

    await this.runRepo.update(runId, { status: 'running' });
    const start = Date.now();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tocktest-'));
    const framework = run.framework === 'cypress' ? 'cypress' : 'playwright';
    const ext = framework === 'cypress' ? 'cy.ts' : 'spec.ts';
    const testFile = path.join(tmpDir, `test.${ext}`);
    fs.writeFileSync(testFile, run.fileContent, 'utf-8');

    const image = DOCKER_IMAGES[framework];
    const containerTestPath = `/tests/test.${ext}`;
    const cmd =
      framework === 'playwright'
        ? `docker run --rm -v "${tmpDir}:/tests" ${image} npx playwright test /tests/test.spec.ts --reporter=json 2>&1`
        : `docker run --rm -v "${tmpDir}:/e2e/cypress/e2e" ${image} 2>&1`;

    try {
      const { stdout } = await execAsync(cmd, { timeout: 120_000 });
      const durationMs = Date.now() - start;

      let testResults: Record<string, unknown> | null = null;
      if (framework === 'playwright') {
        try {
          const jsonMatch = stdout.match(/^\{[\s\S]*\}$/m);
          if (jsonMatch) testResults = JSON.parse(jsonMatch[0]);
        } catch { /* ignore */ }
      }

      const passed = !stdout.includes('failed') && !stdout.includes('Error');
      await this.runRepo.update(runId, {
        status: passed ? 'passed' : 'failed',
        output: stdout.slice(0, 50_000),
        exitCode: 0,
        durationMs,
        testResults: testResults as any,
      });
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const output = (err.stdout ?? '') + (err.stderr ?? '') + (err.message ?? '');
      await this.runRepo.update(runId, {
        status: 'failed',
        output: output.slice(0, 50_000),
        exitCode: err.code ?? 1,
        durationMs,
        errorMessage: err.message?.slice(0, 500) ?? 'Execution failed',
      });
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}
