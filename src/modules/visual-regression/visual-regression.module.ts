import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VisualRegressionController } from './visual-regression.controller';
import { VisualRegressionService } from './visual-regression.service';
import { VisualBaseline } from './entities/visual-baseline.entity';
import { VisualComparison } from './entities/visual-comparison.entity';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([VisualBaseline, VisualComparison]), AiModule],
  controllers: [VisualRegressionController],
  providers: [VisualRegressionService],
})
export class VisualRegressionModule {}
