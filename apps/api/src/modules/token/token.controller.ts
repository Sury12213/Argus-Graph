import { Controller, Get, Param } from '@nestjs/common';
import { TokenService } from './token.service';
import { ApiResponse } from '../../common/dto/api-response.dto';

@Controller('tokens')
export class TokenController {
  constructor(private tokenService: TokenService) {}

  @Get(':address')
  async getToken(@Param('address') address: string) {
    const token = await this.tokenService.getTokenInfo(address);
    return new ApiResponse(token);
  }
}
