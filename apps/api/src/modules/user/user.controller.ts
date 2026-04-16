import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserSettingsDto } from './dto/user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiResponse } from '../../common/dto/api-response.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private userService: UserService) {}

  @Get('me')
  async getProfile(@Request() req: any) {
    const profile = await this.userService.getProfile(req.user.id);
    return new ApiResponse(profile);
  }

  @Patch('settings')
  async updateSettings(
    @Request() req: any,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    const updated = await this.userService.updateSettings(req.user.id, dto);
    return new ApiResponse(updated, 'Settings updated');
  }
}
