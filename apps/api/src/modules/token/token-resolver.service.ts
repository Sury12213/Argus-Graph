import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface TokenResolutionCandidate {
  address: string;
  symbol?: string;
  name?: string;
  source: 'DIRECT_ADDRESS' | 'DEXSCREENER_URL' | 'DEXSCREENER_SEARCH';
  dexId?: string;
  pairAddress?: string;
  liquidityUsd?: number;
  volume24h?: number;
  url?: string;
}

export interface TokenResolutionResult {
  status: 'RESOLVED' | 'AMBIGUOUS';
  tokenAddress?: string;
  candidates?: TokenResolutionCandidate[];
}

@Injectable()
export class TokenResolverService {
  private readonly logger = new Logger(TokenResolverService.name);
  private readonly http = axios.create({ timeout: 8000 });

  async resolve(input: { token_address?: string | null; token_symbol?: string | null; raw_input?: string }): Promise<TokenResolutionResult> {
    const directAddress = input.token_address ?? this.extractAddress(input.raw_input ?? '');
    if (directAddress && this.isValidSolanaAddress(directAddress)) {
      return {
        status: 'RESOLVED',
        tokenAddress: directAddress,
        candidates: [{ address: directAddress, source: 'DIRECT_ADDRESS' }],
      };
    }

    const urlCandidate = await this.resolveDexScreenerUrl(input.raw_input ?? '');
    if (urlCandidate) {
      return {
        status: 'RESOLVED',
        tokenAddress: urlCandidate.address,
        candidates: [urlCandidate],
      };
    }

    const symbol = this.normalizeSymbol(input.token_symbol ?? this.extractSymbol(input.raw_input ?? ''));
    if (symbol) return this.resolveSymbol(symbol);

    throw new BadRequestException({
      code: 'TOKEN_RESOLUTION_FAILED',
      message: 'Provide a valid Solana mint address, DexScreener token URL, or token symbol.',
    });
  }

  private async resolveDexScreenerUrl(rawInput: string): Promise<TokenResolutionCandidate | null> {
    const url = rawInput.match(/https?:\/\/[^\s]+/i)?.[0];
    if (!url || !url.toLowerCase().includes('dexscreener.com/solana/')) return null;

    const slug = url.split('?')[0].split('/').filter(Boolean).pop();
    if (!slug || !this.isValidSolanaAddress(slug)) return null;

    const pair = await this.fetchBestDexScreenerPair(slug);
    if (!pair) {
      return { address: slug, source: 'DEXSCREENER_URL', url };
    }

    return this.toCandidate(pair, 'DEXSCREENER_URL');
  }

  private async resolveSymbol(symbol: string): Promise<TokenResolutionResult> {
    const pairs = await this.searchDexScreener(symbol);
    const candidates = pairs
      .filter((pair: any) => pair.chainId === 'solana' && pair.baseToken?.address && this.isValidSolanaAddress(pair.baseToken.address))
      .filter((pair: any) => (pair.baseToken?.symbol ?? '').toLowerCase() === symbol.toLowerCase())
      .sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
      .slice(0, 5)
      .map((pair: any) => this.toCandidate(pair, 'DEXSCREENER_SEARCH'));

    if (candidates.length === 0) {
      throw new BadRequestException({
        code: 'TOKEN_SYMBOL_NOT_FOUND',
        message: `No verified Solana token candidates found for ${symbol}. Provide the mint address instead.`,
      });
    }

    const top = candidates[0];
    const second = candidates[1];
    const topLiquidity = top.liquidityUsd ?? 0;
    const secondLiquidity = second?.liquidityUsd ?? 0;

    if (candidates.length === 1 || (topLiquidity > 0 && topLiquidity >= secondLiquidity * 3)) {
      return { status: 'RESOLVED', tokenAddress: top.address, candidates };
    }

    return { status: 'AMBIGUOUS', candidates };
  }

  private async fetchBestDexScreenerPair(address: string): Promise<any | null> {
    try {
      const res = await this.http.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
      const pairs = (res.data?.pairs ?? []).filter((pair: any) => pair.chainId === 'solana');
      return pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
    } catch (error: any) {
      this.logger.warn(`[TOKEN_RESOLVER] DexScreener token lookup failed: ${error.message}`);
      return null;
    }
  }

  private async searchDexScreener(query: string): Promise<any[]> {
    try {
      const res = await this.http.get('https://api.dexscreener.com/latest/dex/search', { params: { q: query } });
      return res.data?.pairs ?? [];
    } catch (error: any) {
      this.logger.warn(`[TOKEN_RESOLVER] DexScreener search failed: ${error.message}`);
      throw new BadRequestException({
        code: 'TOKEN_RESOLVER_UNAVAILABLE',
        message: 'Token symbol resolver is temporarily unavailable. Provide a Solana mint address instead.',
      });
    }
  }

  private toCandidate(pair: any, source: TokenResolutionCandidate['source']): TokenResolutionCandidate {
    return {
      address: pair.baseToken.address,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      source,
      dexId: pair.dexId,
      pairAddress: pair.pairAddress,
      liquidityUsd: pair.liquidity?.usd,
      volume24h: pair.volume?.h24,
      url: pair.url,
    };
  }

  private extractAddress(input: string): string | null {
    return input.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/)?.[0] ?? null;
  }

  private extractSymbol(input: string): string | null {
    const stopWords = new Set(['scan', 'analyze', 'check', 'audit', 'token', 'coin', 'risk', 'for', 'please', 'buy', 'sell', 'watch']);
    const tokens = input.match(/\$?[A-Za-z][A-Za-z0-9]{1,15}\b/g) ?? [];
    const symbol = tokens
      .map((token) => token.replace(/^\$/, ''))
      .find((token) => !stopWords.has(token.toLowerCase()));
    return symbol ?? null;
  }

  private normalizeSymbol(symbol?: string | null): string | null {
    const normalized = symbol?.replace(/^\$/, '').trim();
    return normalized ? normalized.toUpperCase() : null;
  }

  private isValidSolanaAddress(value: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  }
}
