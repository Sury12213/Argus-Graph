import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';
import { TokenResolverService } from './token-resolver.service';

@Module({
  controllers: [TokenController],
  providers: [TokenService, TokenResolverService],
  exports: [TokenService, TokenResolverService],
})
export class TokenModule {}
