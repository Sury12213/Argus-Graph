import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../providers/prisma/prisma.service';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Step 1: Generate a nonce for the wallet to sign.
   * This prevents replay attacks.
   */
  async requestNonce(walletAddress: string): Promise<{ nonce: string; message: string }> {
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

    // Find or note the user
    let user = await this.prisma.user.findUnique({
      where: { walletAddress },
    });

    await this.prisma.authNonce.create({
      data: {
        wallet: walletAddress,
        nonce,
        expiresAt,
        userId: user?.id ?? null,
      },
    });

    // The message the wallet must sign
    const message = `Argus-Graph Authentication\n\nWallet: ${walletAddress}\nNonce: ${nonce}\n\nSign this message to verify you own this wallet. This will not trigger a transaction.`;

    this.logger.debug(`Nonce generated for ${walletAddress}: ${nonce}`);
    return { nonce, message };
  }

  /**
   * Step 2: Verify the wallet's signature and issue JWT tokens.
   */
  async verifySignature(
    walletAddress: string,
    signature: string,
    nonce: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: string }> {
    // Find and validate nonce
    const authNonce = await this.prisma.authNonce.findFirst({
      where: {
        wallet: walletAddress,
        nonce,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!authNonce) {
      throw new UnauthorizedException('Invalid or expired nonce');
    }

    // Reconstruct the signed message
    const message = `Argus-Graph Authentication\n\nWallet: ${walletAddress}\nNonce: ${nonce}\n\nSign this message to verify you own this wallet. This will not trigger a transaction.`;

    // Verify ed25519 signature
    const isValid = this.verifyEd25519Signature(
      message,
      signature,
      walletAddress,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Mark nonce as used
    await this.prisma.authNonce.update({
      where: { id: authNonce.id },
      data: { used: true },
    });

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { walletAddress },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          walletAddress,
          displayName: `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`,
        },
      });
      this.logger.log(`New user created: ${user.walletAddress}`);
    }

    // Generate JWT tokens
    const payload = { sub: user.id, wallet: user.walletAddress };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRY', '15m'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRY', '7d'),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get('JWT_EXPIRY', '15m'),
    };
  }

  /**
   * Refresh access token using a valid refresh token.
   */
  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const newPayload = { sub: user.id, wallet: user.walletAddress };
      const accessToken = this.jwtService.sign(newPayload, {
        expiresIn: this.configService.get('JWT_EXPIRY', '15m'),
      });

      return {
        accessToken,
        refreshToken, // Reuse existing refresh token
        expiresIn: this.configService.get('JWT_EXPIRY', '15m'),
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  // ── Helpers ──

  private verifyEd25519Signature(
    message: string,
    signature: string,
    walletAddress: string,
  ): boolean {
    try {
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const publicKeyBytes = bs58.decode(walletAddress);

      return nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKeyBytes,
      );
    } catch (error) {
      this.logger.error(`Signature verification failed: ${error}`);
      return false;
    }
  }
}
