import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { ProjectDoc } from './entities/project-doc.entity';
import { AiService } from '../ai/ai.service';
import { RepositoriesService } from '../repositories/repositories.service';

@Injectable()
export class DocsService {
  constructor(
    @InjectRepository(ProjectDoc)
    private readonly docRepo: TypeOrmRepo<ProjectDoc>,
    private readonly aiService: AiService,
    private readonly repoService: RepositoriesService,
  ) {}

  async getLatestDoc(userId: string, repoId: string): Promise<ProjectDoc | null> {
    await this.repoService.findOneForUser(userId, repoId);
    return this.docRepo.findOne({
      where: { repoId },
      order: { version: 'DESC' },
    });
  }

  async updateDoc(userId: string, repoId: string, content: string, latestVersion?: number): Promise<ProjectDoc> {
    await this.repoService.findOneForUser(userId, repoId);
    const newVersion = (latestVersion ?? (await this.getLatestDocVersion(repoId))) + 1;

    const doc = this.docRepo.create({
      repoId,
      content,
      version: newVersion,
      updatedBy: userId,
    });
    return this.docRepo.save(doc);
  }

  private async getLatestDocVersion(repoId: string): Promise<number> {
    const latest = await this.docRepo.findOne({
      where: { repoId },
      select: ['version'],
      order: { version: 'DESC' },
    });
    return latest?.version ?? 0;
  }

  async getVersions(userId: string, repoId: string) {
    await this.repoService.findOneForUser(userId, repoId);
    return this.docRepo.find({
      where: { repoId },
      select: ['id', 'version', 'updatedAt', 'updatedBy'],
      order: { version: 'DESC' },
      take: 20,
    });
  }

  async deleteDoc(userId: string, repoId: string): Promise<void> {
    await this.repoService.findOneForUser(userId, repoId);
    await this.docRepo.delete({ repoId });
  }

  async autoUpdate(userId: string, repoId: string): Promise<ProjectDoc> {
    const repo = await this.repoService.findOneForUser(userId, repoId);
    const repoInfo = JSON.stringify({
      fullName: repo.fullName,
      description: repo.description,
      defaultBranch: repo.defaultBranch,
    });

    const latest = await this.docRepo.findOne({
      where: { repoId },
      order: { version: 'DESC' },
    });
    const newContent = await this.aiService.autoUpdateDoc(repoInfo, latest?.content ?? '');

    return this.updateDoc(userId, repoId, newContent, latest?.version ?? 0);
  }
}
