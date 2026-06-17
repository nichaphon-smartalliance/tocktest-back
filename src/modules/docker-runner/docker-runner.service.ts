import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository as TypeOrmRepo } from 'typeorm';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TestRun } from './entities/test-run.entity';
import { Repository } from '../repositories/entities/repository.entity';
import type { RunTestsDto } from './dto/run-tests.dto';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const CYPRESS_IMAGE = 'cypress/included:13.6.4';

@Injectable()
export class DockerRunnerService {
  private readonly logger = new Logger(DockerRunnerService.name);
  private dockerAvailabilityCache: { checkedAt: number; available: boolean } | null = null;
  private readonly dockerAvailabilityTtlMs = 30_000;

  constructor(
    @InjectRepository(TestRun) private readonly runRepo: TypeOrmRepo<TestRun>,
    @InjectRepository(Repository) private readonly repoRepo: TypeOrmRepo<Repository>,
  ) {}

  async isDockerAvailable(force = false): Promise<boolean> {
    if (!force && this.dockerAvailabilityCache && Date.now() - this.dockerAvailabilityCache.checkedAt < this.dockerAvailabilityTtlMs) {
      return this.dockerAvailabilityCache.available;
    }

    try {
      await execAsync('docker info', { timeout: 5000 });
      this.dockerAvailabilityCache = { checkedAt: Date.now(), available: true };
      return true;
    } catch {
      this.dockerAvailabilityCache = { checkedAt: Date.now(), available: false };
      return false;
    }
  }

  async enqueueRun(userId: string, repoId: string, dto: RunTestsDto): Promise<TestRun> {
    const repo = await this.repoRepo.findOne({ where: { id: repoId, userId } });
    if (!repo) throw new NotFoundException('Repository not found');

    const activeRun = await this.runRepo.findOne({
      where: { userId, repoId, status: In(['queued', 'running']) },
      order: { createdAt: 'DESC' },
    });
    if (activeRun) {
      throw new BadRequestException('A sandbox run is already in progress for this repository.');
    }

    const name = dto.name?.trim() || `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const run = this.runRepo.create({
      repoId,
      userId,
      framework: dto.framework ?? 'cypress',
      name,
      fileContent: dto.fileContent,
      status: 'queued',
      output: null,
      errorMessage: null,
    });
    const saved = await this.runRepo.save(run);

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

  async listRuns(userId: string, repoId: string, limit = 20, search?: string): Promise<TestRun[]> {
    return this.runRepo.find({
      where: {
        userId,
        repoId,
        ...(search?.trim() ? { name: ILike(`%${search.trim()}%`) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async renameRun(userId: string, repoId: string, runId: string, name: string): Promise<TestRun> {
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException('Run name is required.');

    const run = await this.runRepo.findOne({ where: { id: runId, userId, repoId } });
    if (!run) throw new NotFoundException('Test run not found');
    run.name = trimmed.slice(0, 120);
    return this.runRepo.save(run);
  }

  async deleteRun(userId: string, repoId: string, runId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId, userId, repoId } });
    if (!run) throw new NotFoundException('Test run not found');
    await this.runRepo.delete({ id: runId, userId, repoId });
    return { deleted: true };
  }

  async clearRuns(userId: string, repoId: string) {
    await this.repoRepo.findOne({ where: { id: repoId, userId } });
    await this.runRepo.delete({ userId, repoId });
    return { cleared: true };
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

    await this.runRepo.update(runId, { status: 'running', errorMessage: null, output: 'Preparing Cypress sandbox project...\n' });
    const start = Date.now();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tocktest-'));

    try {
      this.writeSandboxProject(tmpDir, run.fileContent);
      const { stdout, stderr } = await execFileAsync('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--cpus',
        '1',
        '--memory',
        '512m',
        '--pids-limit',
        '256',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=64m',
        '-v', `${tmpDir}:/e2e`,
        '-w', '/e2e',
        CYPRESS_IMAGE,
        'npx', 'cypress', 'run',
        '--config-file', 'cypress.config.js',
        '--spec', 'cypress/e2e/test.cy.ts',
      ], { timeout: 180_000, maxBuffer: 1024 * 1024 * 4 });
      const durationMs = Date.now() - start;
      const output = `${stdout ?? ''}${stderr ?? ''}`;
      const passed = this.isRunSuccessful(output);

      await this.runRepo.update(runId, {
        status: passed ? 'passed' : 'failed',
        output: output.slice(0, 50_000),
        exitCode: passed ? 0 : 1,
        durationMs,
        errorMessage: passed ? null : 'The sandbox run completed but Cypress reported failures.',
        testResults: this.extractTestResults(output) as any,
      });
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const stdout = typeof err?.stdout === 'string' ? err.stdout : '';
      const stderr = typeof err?.stderr === 'string' ? err.stderr : '';
      const output = `${stdout}${stderr}${err?.message ?? ''}`;
      await this.runRepo.update(runId, {
        status: 'failed',
        output: output.slice(0, 50_000),
        exitCode: typeof err?.code === 'number' ? err.code : 1,
        durationMs,
        errorMessage: this.humanizeExecutionError(output, err?.message),
        testResults: this.extractTestResults(output) as any,
      });
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore temp cleanup failures.
      }
    }
  }

  private writeSandboxProject(tmpDir: string, fileContent: string) {
    const e2eDir = path.join(tmpDir, 'cypress', 'e2e');
    fs.mkdirSync(e2eDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'cypress.config.js'),
      [
        'module.exports = {',
        '  video: false,',
        '  screenshotOnRunFailure: false,',
        '  e2e: {',
        "    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',",
        '    supportFile: false,',
        '  },',
        '};',
        '',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'tocktest-sandbox', private: true }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(path.join(e2eDir, 'test.cy.ts'), fileContent, 'utf-8');
  }

  private isRunSuccessful(output: string): boolean {
    const normalized = output.toLowerCase();
    if (normalized.includes('failing') || normalized.includes('failed') || normalized.includes('error')) {
      return false;
    }
    return normalized.includes('passing') || normalized.includes('all specs passed');
  }

  private extractTestResults(output: string) {
    const passing = output.match(/(\d+)\s+passing/i);
    const failing = output.match(/(\d+)\s+failing/i);
    const pending = output.match(/(\d+)\s+pending/i);
    const duration = output.match(/finished in\s+([\d.]+)\s*(ms|s)/i);

    return {
      passing: passing ? Number(passing[1]) : 0,
      failing: failing ? Number(failing[1]) : 0,
      pending: pending ? Number(pending[1]) : 0,
      duration: duration ? `${duration[1]} ${duration[2]}` : null,
    };
  }

  private humanizeExecutionError(output: string, fallback?: string) {
    if (/could not find a cypress configuration file/i.test(output)) {
      return 'The sandbox project did not contain a valid Cypress configuration file.';
    }
    if (/timed out/i.test(output)) {
      return 'The sandbox run timed out before Cypress finished.';
    }
    if (/docker/i.test(output) && /not found|is not recognized/i.test(output)) {
      return 'Docker is unavailable on the backend server.';
    }
    return (fallback ?? 'Execution failed').slice(0, 500);
  }
}
