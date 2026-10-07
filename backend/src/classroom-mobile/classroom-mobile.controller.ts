import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClassroomMobileService } from './classroom-mobile.service';
import {
  ExecuteMobileClassroomCommandDto,
  JoinClassroomMobileDto,
  MobileDiscoveryParamDto,
} from './dto/classroom-mobile.dto';

const CONTROL_SESSION_HEADER = 'x-classroom-control-session';

@Controller('classroom-mobile')
@UseGuards(AuthGuard)
export class ClassroomMobileController {
  constructor(private readonly mobile: ClassroomMobileService) {}

  @Post('join')
  join(
    @Req() request: AuthenticatedRequest,
    @Body() dto: JoinClassroomMobileDto,
  ) {
    return this.mobile.join(request.user, dto);
  }

  @Post('heartbeat')
  heartbeat(
    @Req() request: AuthenticatedRequest,
    @Headers(CONTROL_SESSION_HEADER) sessionToken: string,
  ) {
    return this.mobile.heartbeat(request.user, sessionToken);
  }

  @Post('revoke')
  revoke(
    @Req() request: AuthenticatedRequest,
    @Headers(CONTROL_SESSION_HEADER) sessionToken: string,
  ) {
    return this.mobile.revoke(request.user, sessionToken);
  }

  @Get('state')
  state(
    @Req() request: AuthenticatedRequest,
    @Headers(CONTROL_SESSION_HEADER) sessionToken: string,
  ) {
    return this.mobile.state(request.user, sessionToken);
  }

  @Sse('events')
  events(
    @Req() request: AuthenticatedRequest,
    @Headers(CONTROL_SESSION_HEADER) sessionToken: string,
  ) {
    return this.mobile.stream(request.user, sessionToken);
  }

  @Sse('screen-events')
  screenEvents(
    @Req() request: AuthenticatedRequest,
    @Query('deviceId', ParseIntPipe) deviceId: number,
  ) {
    return this.mobile.screenStream(request.user, deviceId);
  }

  @Post('commands')
  command(
    @Req() request: AuthenticatedRequest,
    @Headers(CONTROL_SESSION_HEADER) sessionToken: string,
    @Body() dto: ExecuteMobileClassroomCommandDto,
  ) {
    return this.mobile.execute(request.user, sessionToken, dto);
  }
}

@Controller('classroom-mobile-discovery')
@UseGuards(ThrottlerGuard)
export class ClassroomMobileDiscoveryController {
  constructor(private readonly mobile: ClassroomMobileService) {}

  @Get(':deviceCode')
  discovery(@Param() params: MobileDiscoveryParamDto) {
    return this.mobile.discovery(params.deviceCode);
  }
}
