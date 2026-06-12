import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestCase } from './entities/test-case.entity';
import { TestCaseFolder } from './entities/test-case-folder.entity';
import { TestCasesController } from './test-cases.controller';
import { TestCasesService } from './test-cases.service';
import { TestExportService } from './test-export.service';
import { RepositoriesModule } from '../repositories/repositories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestCase, TestCaseFolder]),
    RepositoriesModule,
  ],
  controllers: [TestCasesController],
  providers: [TestCasesService, TestExportService],
  exports: [TestCasesService, TestExportService],
})
export class TestCasesModule {}
