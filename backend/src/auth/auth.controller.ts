import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService, type LoginResult } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto.account, dto.password);
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  profile(@Req() request: AuthenticatedRequest) {
    return {
      teacherId: request.user.sub,
      account: request.user.account,
      name: request.user.name,
    };
  }
}
