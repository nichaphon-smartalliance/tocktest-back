import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepoSettings } from './entities/repo-settings.entity';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { RepositoriesModule } from '../repositories/repositories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RepoSettings]),
    RepositoriesModule,
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
