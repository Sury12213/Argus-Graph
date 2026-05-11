import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';

export interface JupiterQuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}

@Injectable()
export class JupiterService {
  private readonly quoteEndpoint = 'https://lite-api.jup.ag/swap/v1/quote';
  private readonly swapEndpoint = 'https://lite-api.jup.ag/swap/v1/swap';

  async getQuote(params: JupiterQuoteRequest) {
    this.validateQuoteParams(params);
    const url = new URL(this.quoteEndpoint);
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', params.amount);
    url.searchParams.set('slippageBps', String(params.slippageBps));

    const response = await this.fetchJson(url);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'JUPITER_QUOTE_FAILED',
        message: body?.error ?? body?.message ?? 'Jupiter quote request failed.',
      });
    }
    return body;
  }

  async buildSwapTransaction(quoteResponse: unknown, userPublicKey: string) {
    this.validatePublicKey(userPublicKey, 'userPublicKey');
    const response = await this.fetchJson(this.swapEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'JUPITER_SWAP_BUILD_FAILED',
        message: body?.error ?? body?.message ?? 'Jupiter swap transaction build failed.',
      });
    }
    if (!body?.swapTransaction) {
      throw new ServiceUnavailableException({
        code: 'JUPITER_SWAP_TRANSACTION_MISSING',
        message: 'Jupiter did not return a swap transaction.',
      });
    }
    return body;
  }

  private async fetchJson(input: string | URL, init?: RequestInit) {
    try {
      return await fetch(input, init);
    } catch (error: any) {
      throw new ServiceUnavailableException({
        code: 'JUPITER_UNREACHABLE',
        message: error?.cause?.code === 'ENOTFOUND'
          ? 'Jupiter API host could not be resolved. Check internet/DNS connectivity.'
          : 'Jupiter API is unreachable. Try again later.',
      });
    }
  }

  private validateQuoteParams(params: JupiterQuoteRequest) {
    this.validatePublicKey(params.inputMint, 'inputMint');
    this.validatePublicKey(params.outputMint, 'outputMint');
    if (!/^[1-9]\d*$/.test(params.amount)) {
      throw new BadRequestException({ code: 'INVALID_SWAP_AMOUNT', message: 'amount must be a positive integer string.' });
    }
    if (!Number.isInteger(params.slippageBps) || params.slippageBps < 10 || params.slippageBps > 5000) {
      throw new BadRequestException({ code: 'INVALID_SLIPPAGE', message: 'slippageBps must be between 10 and 5000.' });
    }
  }

  private validatePublicKey(value: string, field: string) {
    try {
      new PublicKey(value);
    } catch {
      throw new BadRequestException({ code: 'INVALID_PUBLIC_KEY', message: `${field} must be a valid Solana public key.` });
    }
  }
}
