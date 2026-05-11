import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { LlmModule } from '../../providers/ai/llm.module';

@Module({
  imports: [LlmModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
