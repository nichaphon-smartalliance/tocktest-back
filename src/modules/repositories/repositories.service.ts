import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo, ILike } from 'typeorm';
import axios from 'axios';
import { Repository } from './entities/repository.entity';
import { GithubTokensService } from '../github-tokens/github-tokens.service';
import { toPageResult } from '../../common/dto/pagination.dto';

@Injectable()
export class RepositoriesService {
  constructor(
    @InjectRepository(Repository)
    private readonly repoRepository: TypeOrmRepo<Repository>,
    private readonly githubTokensService: GithubTokensService,
  ) {}

  async findAll(userId: string, params: { search?: string; page?: number; pageSize?: number }) {
    const { search, page = 1, pageSize = 20 } = params;
    const where: any = { userId };
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

  async syncFromGithub(userId: string): Promise<{ synced: number; total: number }> {
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('ไม่พบ GitHub Token กรุณาเพิ่มก่อน');

    const githubRepos = await this.fetchGithubRepos(pat);
    let synced = 0;

    for (const gr of githubRepos) {
      await this.repoRepository.upsert(
        {
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
          lastSyncedAt: new Date(),
        },
        { conflictPaths: ['userId', 'githubRepoId'] },
      );
      synced++;
    }

    return { synced, total: githubRepos.length };
  }

  async getBranches(userId: string, repoId: string): Promise<any[]> {
    const repo = await this.findOneForUser(userId, repoId);
    const pat = await this.githubTokensService.getDecryptedToken(userId);
    if (!pat) throw new NotFoundException('ไม่พบ GitHub Token กรุณาเพิ่มก่อน');

    const res = await axios.get(`https://api.github.com/repos/${repo.fullName}/branches`, {
      headers: { Authorization: `token ${pat}` },
      params: { per_page: 100 },
    });
    // return simplified branch list
    return res.data.map((b: any) => ({ name: b.name, commitSha: b.commit?.sha }));
  }

  private async fetchGithubRepos(pat: string): Promise<any[]> {
    const repos: any[] = [];
    let page = 1;
    while (true) {
      const res = await axios.get('https://api.github.com/user/repos', {
        headers: { Authorization: `token ${pat}` },
        params: { per_page: 100, page, sort: 'updated' },
      });
      repos.push(...res.data);
      if (res.data.length < 100) break;
      page++;
    }
    return repos;
  }
}
