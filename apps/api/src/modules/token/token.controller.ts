import { Controller, Get, Param } from '@nestjs/common';
import { TokenService } from './token.service';
import { TokenResolverService } from './token-resolver.service';
import { ApiResponse } from '../../common/dto/api-response.dto';

@Controller('tokens')
export class TokenController {
  constructor(
    private tokenService: TokenService,
    private tokenResolver: TokenResolverService,
  ) {}

  @Get('resolve/:query')
  async resolveToken(@Param('query') query: string) {
    const token = await this.tokenResolver.resolve({ raw_input: decodeURIComponent(query) });
    return new ApiResponse(token);
  }

  @Get(':address')
  async getToken(@Param('address') address: string) {
    const token = await this.tokenService.getTokenInfo(address);
    return new ApiResponse(token);
  }
}
