import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestCase } from './entities/test-case.entity';
import { TestCaseFolder } from './entities/test-case-folder.entity';
import { TestCasesController } from './test-cases.controller';
import { TestCasesService } from './test-cases.service';
import { RepositoriesModule } from '../repositories/repositories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestCase, TestCaseFolder]),
    RepositoriesModule,
  ],
  controllers: [TestCasesController],
  providers: [TestCasesService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
