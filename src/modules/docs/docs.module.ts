import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectDoc } from './entities/project-doc.entity';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { AiModule } from '../ai/ai.module';
import { RepositoriesModule } from '../repositories/repositories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectDoc]),
    AiModule,
    RepositoriesModule,
  ],
  controllers: [DocsController],
  providers: [DocsService],
})
export class DocsModule {}
