import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { UserService } from '../user/user.service';
import { JupiterService } from './jupiter.service';

const EXECUTION_TTL_MS = 2 * 60 * 1000;
export interface CreateGuardianQuoteParams {
  userId: string;
  walletAddress: string;
  scanId?: string;
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  tokenAddress?: string;
}

@Injectable()
export class GuardianExecutionService {
  private readonly logger = new Logger(GuardianExecutionService.name);
  private readonly connection: Connection;

  constructor(
    private prisma: PrismaService,
    private user: UserService,
    private jupiter: JupiterService,
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

  async createQuote(params: CreateGuardianQuoteParams) {
    this.validatePublicKey(params.inputMint, 'inputMint');
    this.validatePublicKey(params.outputMint, 'outputMint');
    if (!/^[1-9]\d*$/.test(params.amountRaw)) {
      throw new BadRequestException({ code: 'INVALID_SWAP_AMOUNT', message: 'amountRaw must be a positive integer string.' });
    }

    const settings = await this.user.getUserSettings(params.userId);
    const scan = params.scanId
      ? await this.prisma.scan.findFirst({ where: { id: params.scanId, userId: params.userId } })
      : null;
    if (params.scanId && !scan) throw new NotFoundException('Scan not found');

    if (scan?.tokenAddress && scan.tokenAddress !== params.inputMint) {
      throw new BadRequestException({ code: 'TOKEN_MISMATCH', message: 'Input mint must match the scanned token.' });
    }
    if (params.tokenAddress && params.tokenAddress !== params.inputMint) {
      throw new BadRequestException({ code: 'TOKEN_MISMATCH', message: 'tokenAddress must match inputMint.' });
    }

    const slippageBps = Math.max(10, Math.min(settings?.slippageBps ?? 100, 5000));
    const quoteRequest = {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amountRaw,
      slippageBps,
    };
    const quoteResponse = await this.jupiter.getQuote(quoteRequest);
    const expiresAt = new Date(Date.now() + EXECUTION_TTL_MS);
    const tokenAddress = params.tokenAddress ?? params.inputMint;
    const riskDecision = scan?.decision ?? 'UNSCANNED';

    const execution = await this.prisma.guardianExecution.create({
      data: {
        userId: params.userId,
        scanId: scan?.id,
        walletAddress: params.walletAddress,
        tokenAddress,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amountRaw: params.amountRaw,
        slippageBps,
        riskDecision,
        riskScore: scan?.finalScore,
        status: 'QUOTE_READY',
        quoteRequest,
        quoteResponse,
        expiresAt,
      },
    });

    return this.toDto(execution);
  }

  async buildUnsignedSwap(userId: string, walletAddress: string, executionId: string) {
    const execution = await this.getOwnedExecution(userId, executionId);
    this.assertWalletMatch(execution.walletAddress, walletAddress);
    if (execution.status !== 'QUOTE_READY') {
      throw new BadRequestException({ code: 'INVALID_EXECUTION_STATUS', message: 'Execution is not ready for swap build.' });
    }
    this.assertNotExpired(execution.expiresAt);

    const swapResponse = await this.jupiter.buildSwapTransaction(execution.quoteResponse, walletAddress);
    const updated = await this.prisma.guardianExecution.update({
      where: { id: execution.id },
      data: {
        status: 'AWAITING_SIGNATURE',
        swapResponse,
      },
    });

    return {
      ...this.toDto(updated),
      swapTransaction: swapResponse.swapTransaction,
      lastValidBlockHeight: swapResponse.lastValidBlockHeight ?? null,
    };
  }

  async recordSubmittedTransaction(userId: string, walletAddress: string, executionId: string, transactionSignature: string) {
    const execution = await this.getOwnedExecution(userId, executionId);
    this.assertWalletMatch(execution.walletAddress, walletAddress);
    this.assertNotExpired(execution.expiresAt);
    if (!transactionSignature.trim()) {
      throw new BadRequestException({ code: 'INVALID_TRANSACTION_SIGNATURE', message: 'transactionSignature is required.' });
    }
    if (execution.status !== 'AWAITING_SIGNATURE' && execution.status !== 'SUBMITTED') {
      throw new BadRequestException({ code: 'INVALID_EXECUTION_STATUS', message: 'Execution is not awaiting a wallet signature.' });
    }

    const updated = await this.prisma.guardianExecution.update({
      where: { id: execution.id },
      data: {
        status: 'SUBMITTED',
        transactionSignature,
        submittedAt: new Date(),
      },
    });
    return this.toDto(updated);
  }

  async getExecution(userId: string, executionId: string) {
    return this.toDto(await this.getOwnedExecution(userId, executionId));
  }

  async listExecutions(userId: string, scanId?: string) {
    const executions = await this.prisma.guardianExecution.findMany({
      where: { userId, ...(scanId ? { scanId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return executions.map((execution: any) => this.toDto(execution));
  }

  async getTokenBalance(walletAddress: string, mintAddress: string) {
    const wallet = this.validatePublicKey(walletAddress, 'walletAddress');
    const mint = this.validatePublicKey(mintAddress, 'mint');

    try {
      const accountGroup = await this.connection.getParsedTokenAccountsByOwner(wallet, { mint });
      const tokenAmounts = accountGroup.value
        .map((account) => account.account.data.parsed.info.tokenAmount);
      const decimals = tokenAmounts[0]?.decimals ?? 0;
      const balanceRaw = tokenAmounts.reduce((sum, tokenAmount) => sum + BigInt(tokenAmount.amount), 0n);

      return {
        mint: mintAddress,
        walletAddress,
        decimals,
        balanceRaw: balanceRaw.toString(),
        balanceUi: Number(balanceRaw) / 10 ** decimals,
      };
    } catch (error: any) {
      this.logger.warn(`Guardian token balance lookup failed for ${mintAddress}: ${error?.message ?? error}`);
      throw new ServiceUnavailableException({
        code: 'SOLANA_RPC_UNAVAILABLE',
        message: error?.message ?? 'Solana RPC failed while loading wallet token balance.',
      });
    }
  }

  async markSubmittedExecutions() {
    const executions = await this.prisma.guardianExecution.findMany({
      where: { status: 'SUBMITTED' },
      take: 25,
    });
    return executions;
  }

  private async getOwnedExecution(userId: string, executionId: string) {
    const execution = await this.prisma.guardianExecution.findFirst({ where: { id: executionId, userId } });
    if (!execution) throw new NotFoundException('Guardian execution not found');
    return execution;
  }

  private assertWalletMatch(storedWallet: string, walletAddress: string) {
    if (storedWallet !== walletAddress) {
      throw new ForbiddenException({ code: 'WALLET_MISMATCH', message: 'Execution wallet does not match authenticated wallet.' });
    }
  }

  private validatePublicKey(value: string, field: string) {
    try {
      return new PublicKey(value);
    } catch {
      throw new BadRequestException({ code: 'INVALID_PUBLIC_KEY', message: `${field} must be a valid Solana public key.` });
    }
  }

  private assertNotExpired(expiresAt?: Date | null) {
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException({ code: 'EXECUTION_EXPIRED', message: 'Quote expired. Request a fresh quote before signing.' });
    }
  }

  private toDto(execution: any) {
    return {
      id: execution.id,
      scanId: execution.scanId,
      walletAddress: execution.walletAddress,
      tokenAddress: execution.tokenAddress,
      inputMint: execution.inputMint,
      outputMint: execution.outputMint,
      amountRaw: execution.amountRaw,
      slippageBps: execution.slippageBps,
      riskDecision: execution.riskDecision,
      riskScore: execution.riskScore,
      status: execution.status,
      quoteResponse: execution.quoteResponse,
      transactionSignature: execution.transactionSignature,
      confirmationSlot: execution.confirmationSlot,
      confirmationStatus: execution.confirmationStatus,
      failureReason: execution.failureReason,
      expiresAt: execution.expiresAt,
      submittedAt: execution.submittedAt,
      confirmedAt: execution.confirmedAt,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    };
  }
}
