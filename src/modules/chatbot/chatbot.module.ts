import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { AiModule } from '../ai/ai.module';
import { Repository } from '../repositories/entities/repository.entity';
import { TestCase } from '../test-cases/entities/test-case.entity';
import { CommitAnalysis } from '../analysis/entities/commit-analysis.entity';
import { ProjectDoc } from '../docs/entities/project-doc.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Repository, TestCase, CommitAnalysis, ProjectDoc]),
    AiModule,
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService],
})
export class ChatbotModule {}
