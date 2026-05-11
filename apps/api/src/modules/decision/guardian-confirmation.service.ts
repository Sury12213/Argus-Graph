import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../providers/prisma/prisma.service';

@Injectable()
export class GuardianConfirmationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuardianConfirmationService.name);
  private timer?: NodeJS.Timeout;
  private readonly connection: Connection;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    const heliusRpcUrl = config.get<string>('HELIUS_RPC_URL')?.trim();
    const solanaRpcUrl = config.get<string>('SOLANA_RPC_URL')?.trim();
    const heliusApiKey = config.get<string>('HELIUS_API_KEY')?.trim();
    const rpcUrl = heliusRpcUrl
      || (heliusApiKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}` : '')
      || solanaRpcUrl
      || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  onModuleInit() {
    this.timer = setInterval(() => this.checkSubmitted().catch((error) => this.logger.warn(error.message)), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async checkSubmitted() {
    const executions = await this.prisma.guardianExecution.findMany({
      where: { status: 'SUBMITTED', transactionSignature: { not: null } },
      take: 25,
    });

    for (const execution of executions) {
      const signature = execution.transactionSignature;
      if (!signature) continue;
      const status = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      const value = status.value;
      if (!value) {
        if (execution.submittedAt && Date.now() - execution.submittedAt.getTime() > 10 * 60 * 1000) {
          await this.prisma.guardianExecution.update({
            where: { id: execution.id },
            data: { status: 'EXPIRED', failureReason: 'Transaction was not confirmed before the monitoring window expired.' },
          });
        }
        continue;
      }

      if (value.err) {
        await this.prisma.guardianExecution.update({
          where: { id: execution.id },
          data: {
            status: 'FAILED',
            confirmationSlot: value.slot,
            confirmationStatus: value.confirmationStatus ?? 'failed',
            failureReason: JSON.stringify(value.err),
          },
        });
        continue;
      }

      if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') {
        await this.prisma.guardianExecution.update({
          where: { id: execution.id },
          data: {
            status: 'CONFIRMED',
            confirmationSlot: value.slot,
            confirmationStatus: value.confirmationStatus,
            confirmedAt: new Date(),
          },
        });
      }
    }
  }
}
