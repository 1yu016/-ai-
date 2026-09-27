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
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthService, type LoginResult } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { LogoutDto, RefreshTokenDto } from './dto/token.dto';

function requestIp(request: Request): string | undefined {
  return request.ip || request.socket.remoteAddress;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResult> {
    return this.authService.login(dto.account, dto.password, {
      deviceInfo: dto.deviceInfo,
      ipAddress: requestIp(request),
    });
  }

  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  adminLogin(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<LoginResult> {
    return this.authService.loginAdministrator(dto.account, dto.password, {
      deviceInfo: dto.deviceInfo,
      ipAddress: requestIp(request),
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<LoginResult> {
    return this.authService.refresh(dto.refreshToken, {
      deviceInfo: dto.deviceInfo,
      ipAddress: requestIp(request),
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async logout(
    @Body() dto: LogoutDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.authService.logout(request.user, dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async logoutAll(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.authService.logoutAll(request.user);
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  profile(@Req() request: AuthenticatedRequest) {
    return {
      userId: request.user.sub,
      teacherId:
        request.user.userType === 'teacher' ? request.user.sub : undefined,
      administratorId:
        request.user.userType === 'administrator'
          ? request.user.sub
          : undefined,
      account: request.user.account,
      name: request.user.name,
      role: request.user.role,
      userType: request.user.userType,
      schoolId: request.user.schoolId ?? null,
    };
  }
}
