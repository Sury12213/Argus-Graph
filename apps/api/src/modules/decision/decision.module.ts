import { Module } from '@nestjs/common';
import { DecisionService } from './decision.service';
import { GuardianExecutionService } from './guardian-execution.service';
import { JupiterService } from './jupiter.service';
import { GuardianExecutionController } from './guardian-execution.controller';
import { GuardianConfirmationService } from './guardian-confirmation.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  controllers: [GuardianExecutionController],
  providers: [DecisionService, GuardianExecutionService, JupiterService, GuardianConfirmationService],
  exports: [DecisionService, GuardianExecutionService],
})
export class DecisionModule {}
