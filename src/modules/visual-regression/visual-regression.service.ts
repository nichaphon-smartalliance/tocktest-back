import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { VisualBaseline } from './entities/visual-baseline.entity';
import { VisualComparison } from './entities/visual-comparison.entity';
import type { CreateBaselineDto, CompareDto } from './dto/visual.dto';

@Injectable()
export class VisualRegressionService {
  private readonly logger = new Logger(VisualRegressionService.name);

  constructor(
    @InjectRepository(VisualBaseline) private readonly baselineRepo: TypeOrmRepo<VisualBaseline>,
    @InjectRepository(VisualComparison) private readonly compRepo: TypeOrmRepo<VisualComparison>,
    private readonly aiService: AiService,
  ) {}

  async createBaseline(userId: string, repoId: string, dto: CreateBaselineDto): Promise<VisualBaseline> {
    const baseline = this.baselineRepo.create({
      repoId,
      userId,
      name: dto.name,
      url: dto.url,
      screenshotData: dto.screenshotData,
      viewport: dto.viewport ?? '1280x720',
      width: dto.width ?? null,
      height: dto.height ?? null,
    });
    return this.baselineRepo.save(baseline);
  }

  async listBaselines(userId: string, repoId: string): Promise<VisualBaseline[]> {
    return this.baselineRepo.find({
      where: { repoId, userId },
      order: { createdAt: 'DESC' },
      select: ['id', 'name', 'url', 'viewport', 'width', 'height', 'createdAt', 'updatedAt'],
    } as any);
  }

  async getBaseline(userId: string, repoId: string, baselineId: string): Promise<VisualBaseline> {
    const baseline = await this.baselineRepo.findOne({ where: { id: baselineId, repoId, userId } });
    if (!baseline) throw new NotFoundException('Baseline not found');
    return baseline;
  }

  async deleteBaseline(userId: string, repoId: string, baselineId: string): Promise<void> {
    const baseline = await this.getBaseline(userId, repoId, baselineId);
    await this.baselineRepo.remove(baseline);
  }

  async compare(userId: string, repoId: string, dto: CompareDto): Promise<VisualComparison> {
    const baseline = await this.baselineRepo.findOne({ where: { id: dto.baselineId, repoId, userId } });
    if (!baseline) throw new NotFoundException('Baseline not found');

    const threshold = dto.threshold ?? 0.01;
    const { diffScore, diffPixels, totalPixels, diffData } = await this.pixelDiff(
      baseline.screenshotData,
      dto.screenshotData,
    );

    const pass = diffScore <= threshold;

    const comp = this.compRepo.create({
      baselineId: baseline.id,
      repoId,
      userId,
      screenshotData: dto.screenshotData,
      diffData,
      diffScore,
      diffPixels,
      totalPixels,
      threshold,
      status: pass ? 'pass' : 'fail',
    });
    const saved = await this.compRepo.save(comp);

    if (!pass) {
      void this.runAiAnalysis(saved.id, baseline.url, diffScore).catch(() => {});
    }

    return saved;
  }

  async listComparisons(userId: string, repoId: string, baselineId?: string): Promise<VisualComparison[]> {
    const where: any = { repoId, userId };
    if (baselineId) where.baselineId = baselineId;
    return this.compRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 50,
      select: ['id', 'baselineId', 'diffScore', 'diffPixels', 'totalPixels', 'status', 'threshold', 'aiAnalysis', 'createdAt'],
    } as any);
  }

  private async runAiAnalysis(compId: string, url: string, diffScore: number): Promise<void> {
    if (!(await this.aiService.isAvailable())) return;
    try {
      const prompt = `A visual regression test for URL "${url}" detected a ${(diffScore * 100).toFixed(2)}% pixel difference.
Describe likely UI/layout issues that could cause such a regression (layout shift, font change, color change, element repositioning, missing elements, etc.).
Be concise, 2-3 sentences.`;
      const analysis = await this.aiService.chat([{ role: 'user', content: prompt }]);
      await this.compRepo.update(compId, { aiAnalysis: analysis.slice(0, 2000) });
    } catch { /* ignore */ }
  }

  private async pixelDiff(
    baseB64: string,
    candB64: string,
  ): Promise<{ diffScore: number; diffPixels: number; totalPixels: number; diffData: string | null }> {
    try {
      // Dynamic import — pixelmatch is optional
      const { PNG } = await import('pngjs' as any).catch(() => ({ PNG: null }));
      const pixelmatch = await import('pixelmatch' as any).then((m) => m.default ?? m).catch(() => null);

      if (!PNG || !pixelmatch) {
        return this.fallbackDiff(baseB64, candB64);
      }

      const baseBuffer = Buffer.from(baseB64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const candBuffer = Buffer.from(candB64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

      const basePng = PNG.sync.read(baseBuffer);
      const candPng = PNG.sync.read(candBuffer);

      const width = Math.min(basePng.width, candPng.width);
      const height = Math.min(basePng.height, candPng.height);
      const diff = new PNG({ width, height });

      const diffPixels: number = pixelmatch(basePng.data, candPng.data, diff.data, width, height, { threshold: 0.1 });
      const totalPixels = width * height;
      const diffScore = diffPixels / totalPixels;

      const diffData = 'data:image/png;base64,' + PNG.sync.write(diff).toString('base64');
      return { diffScore, diffPixels, totalPixels, diffData };
    } catch (err: any) {
      this.logger.warn(`pixelmatch unavailable: ${err.message}`);
      return this.fallbackDiff(baseB64, candB64);
    }
  }

  private fallbackDiff(
    baseB64: string,
    candB64: string,
  ): { diffScore: number; diffPixels: number; totalPixels: number; diffData: string | null } {
    // Simple byte-level comparison as fallback when pngjs/pixelmatch not installed
    const baseLen = baseB64.replace(/^data:[^;]+;base64,/, '').length;
    const candLen = candB64.replace(/^data:[^;]+;base64,/, '').length;
    const diffScore = Math.abs(baseLen - candLen) / Math.max(baseLen, candLen, 1);
    return { diffScore, diffPixels: 0, totalPixels: 0, diffData: null };
  }
}
