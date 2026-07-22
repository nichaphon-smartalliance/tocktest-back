import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo, ILike, Not, In, FindOptionsWhere } from 'typeorm';
import { Repository } from './entities/repository.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { GithubApiClient } from '../../common/github/github-api.client';
import { toPageResult } from '../../common/dto/pagination.dto';

@Injectable()
export class RepositoriesService {
  constructor(
    @InjectRepository(Repository)
    private readonly repoRepository: TypeOrmRepo<Repository>,
    private readonly githubTokensService: GithubTokensService,
    private readonly githubApi: GithubApiClient,
  ) {}

  async findAll(userId: string, params: { search?: string; page?: number; pageSize?: number }) {
    const { search, page = 1, pageSize = 100 } = params;
    const where: FindOptionsWhere<Repository> = { userId };
    if (search) where.fullName = ILike(`%${search}%`);

    const [items, total] = await this.repoRepository.findAndCount({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { lastSyncedAt: 'DESC', createdAt: 'DESC' },
    });

    return toPageResult(items, total, page, pageSize);
  }

  async findOne(userId: string, id: string): Promise<Repository> {
    const repo = await this.repoRepository.findOne({ where: { id, userId } });
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }

  async findOneForUser(userId: string, repoId: string): Promise<Repository> {
    const repo = await this.repoRepository.findOne({ where: { id: repoId, userId } });
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }

  /**
   * คืน repo.id ของทุก row ที่เป็น GitHub repo เดียวกัน (githubRepoId เท่ากัน)
   * เพื่อให้ผู้ใช้ที่จับคู่กันเห็น test case / folder ชุดเดียวกัน
   * ยังคงตรวจสิทธิ์ก่อนว่า user ที่ขอเป็นเจ้าของ repo row ที่ส่งมาจริง
   */
  async getSharedRepoIds(userId: string, repoId: string): Promise<string[]> {
    const repo = await this.findOneForUser(userId, repoId);
    return [repo.id];
  }

  async syncFromGithub(userId: string): Promise<{ synced: number; total: number }> {
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('ไม่พบ GitHub Token กรุณาเพิ่มก่อน');

    const githubRepos = await this.fetchGithubRepos(pat);

    const liveIds = githubRepos.map((gr) => gr.id);
    if (liveIds.length > 0) {
      await this.repoRepository.delete({
        userId,
        githubRepoId: Not(In(liveIds)),
      });
    } else {
      await this.repoRepository.delete({ userId });
    }

    const now = new Date();
    const rows = githubRepos.map((gr) => ({
      userId,
      githubRepoId: gr.id,
      fullName: gr.full_name,
      name: gr.name,
      description: gr.description,
      defaultBranch: gr.default_branch,
      isPrivate: gr.private,
      htmlUrl: gr.html_url,
      cloneUrl: gr.clone_url,
      ownerLogin: gr.owner?.login,
      lastSyncedAt: now,
    }));

    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await this.repoRepository.upsert(rows.slice(i, i + CHUNK), {
        conflictPaths: ['userId', 'githubRepoId'],
      });
    }

    return { synced: rows.length, total: githubRepos.length };
  }

  async getBranches(userId: string, repoId: string): Promise<{ name: string; commitSha: string }[]> {
    const repo = await this.findOneForUser(userId, repoId);
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('ไม่พบ GitHub Token กรุณาเพิ่มก่อน');

    const branches = await this.githubApi.listAllBranches(repo.fullName, pat);
    return branches.map((b) => ({ name: b.name, commitSha: b.commit?.sha }));
  }

  private async fetchGithubRepos(pat: string) {
    return this.githubApi.listAllUserRepos(pat, 'owner');
  }
}
