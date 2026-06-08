import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { Repository } from '../repositories/entities/repository.entity';
import { GithubTokensModule } from '../github-tokens/github-tokens.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Repository]),
    GithubTokensModule,
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
