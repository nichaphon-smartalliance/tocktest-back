import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository as TypeOrmRepo } from 'typeorm';
import { RepoSettings } from './entities/repo-settings.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import type { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(RepoSettings)
    private readonly settingsRepo: TypeOrmRepo<RepoSettings>,
    private readonly repoService: RepositoriesService,
  ) {}

  async getSettings(userId: string, repoId: string): Promise<RepoSettings> {
    await this.repoService.findOneForUser(userId, repoId);

    let settings = await this.settingsRepo.findOne({ where: { repoId } });
    if (!settings) {
      settings = this.settingsRepo.create({ repoId });
      settings = await this.settingsRepo.save(settings);
    }
    return settings;
  }

  async updateSettings(userId: string, repoId: string, dto: UpdateSettingsDto): Promise<RepoSettings> {
    const settings = await this.getSettings(userId, repoId);
    Object.assign(settings, dto);
    return this.settingsRepo.save(settings);
  }
}
