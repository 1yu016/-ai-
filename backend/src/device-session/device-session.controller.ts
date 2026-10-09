import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { DeviceSessionService } from './device-session.service';

const DEVICE_SESSION_HEADER = 'x-device-session';

/**
 * 签发设备会话：使用 teacher JWT（Teacher Identity 负责绑定/管理设备）。
 * 路由 /devices/:id/device-session。
 */
@Controller('devices')
@UseGuards(AuthGuard)
export class DeviceSessionIssueController {
  constructor(private readonly service: DeviceSessionService) {}

  @Post(':id/device-session')
  issue(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.issue(request.user, id);
  }
}

/**
 * 设备心跳：仅验证 x-device-session header，不依赖 teacher JWT。
 * Device Identity 负责 heartbeat / online。
 */
@Controller('device-session')
@UseGuards(ThrottlerGuard)
export class DeviceSessionHeartbeatController {
  constructor(private readonly service: DeviceSessionService) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(@Headers(DEVICE_SESSION_HEADER) token: string) {
    return this.service.heartbeat(token);
  }
}