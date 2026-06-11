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

  async updateDoc(userId: string, repoId: string, content: string): Promise<ProjectDoc> {
    await this.repoService.findOneForUser(userId, repoId);
    const latest = await this.getLatestDoc(userId, repoId);
    const newVersion = (latest?.version ?? 0) + 1;

    const doc = this.docRepo.create({
      repoId,
      content,
      version: newVersion,
      updatedBy: userId,
    });
    return this.docRepo.save(doc);
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
    // We try-catch the repo retrieval so AI functionality can attempt to fall back 
    // if the repository entry is truly missing from the DB table.
    let repoInfo = '{}';
    try {
      const repo = await this.repoService.findOneForUser(userId, repoId);
      repoInfo = JSON.stringify({
        fullName: repo.fullName,
        description: repo.description,
        defaultBranch: repo.defaultBranch,
      });
    } catch (e) {
      console.warn('Repository metadata row missing from DB, proceeding with empty metadata for AI.');
    }

    const latest = await this.getLatestDoc(userId, repoId);
    const newContent = await this.aiService.autoUpdateDoc(
      repoInfo,
      latest?.content ?? '',
    );

    return this.updateDoc(userId, repoId, newContent);
  }
}