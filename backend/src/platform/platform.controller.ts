import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  AuditLogQueryDto,
  BindDeviceDto,
  BindTeacherDto,
  ClassQueryDto,
  ClassRewardQueryDto,
  ConsentQueryDto,
  ConsumeTicketDto,
  CreateClassDto,
  CreateClassroomDto,
  CreateDeviceDto,
  CreateStudentDto,
  CreateTeacherDto,
  CreateTicketDto,
  DeviceHeartbeatDto,
  DeviceCodeParamDto,
  PageQueryDto,
  RewardLeaderboardQueryDto,
  StudentQueryDto,
  SyncStudentsDto,
  TeacherQueryDto,
  UpdateClassDto,
  UpdateClassroomDto,
  UpdateDeviceDto,
  UpdateStudentDto,
  UpdateTeacherDto,
  UpsertConsentDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

@Controller()
@UseGuards(AuthGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Post('classes') createClass(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateClassDto,
  ) {
    return this.platform.createClass(req.user, dto);
  }
  @Get('classes') listClasses(
    @Req() req: AuthenticatedRequest,
    @Query() query: ClassQueryDto,
  ) {
    return this.platform.listClasses(req.user, query);
  }
  @Get('classes/:id') classDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.platform.classDetail(req.user, id);
  }
  @Patch('classes/:id') updateClass(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClassDto,
  ) {
    return this.platform.updateClass(req.user, id, dto);
  }

  @Post('classes/:classId/teachers') bindTeacher(
    @Req() req: AuthenticatedRequest,
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: BindTeacherDto,
  ) {
    return this.platform.bindTeacher(req.user, classId, dto);
  }
  @Get('classes/:classId/teachers') classTeachers(
    @Req() req: AuthenticatedRequest,
    @Param('classId', ParseIntPipe) classId: number,
  ) {
    return this.platform.classTeachers(req.user, classId);
  }
  @Get('classes/:classId/device-bindings') classDeviceBindings(
    @Req() req: AuthenticatedRequest,
    @Param('classId', ParseIntPipe) classId: number,
  ) {
    return this.platform.listClassDeviceBindings(req.user, classId);
  }
  @Get('classes/:classId/rewards') classRewards(
    @Req() req: AuthenticatedRequest,
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: ClassRewardQueryDto,
  ) {
    return this.platform.listClassRewards(req.user, classId, query);
  }
  @Get('classes/:classId/rewards/leaderboard') rewardLeaderboard(
    @Req() req: AuthenticatedRequest,
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: RewardLeaderboardQueryDto,
  ) {
    return this.platform.rewardLeaderboard(req.user, classId, query.limit);
  }
  @Delete('classes/:classId/teachers/:teacherId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unbindTeacher(
    @Req() req: AuthenticatedRequest,
    @Param('classId', ParseIntPipe) classId: number,
    @Param('teacherId', ParseIntPipe) teacherId: number,
  ) {
    return this.platform.unbindTeacher(req.user, classId, teacherId);
  }

  @Get('teachers') listTeachers(
    @Req() req: AuthenticatedRequest,
    @Query() query: TeacherQueryDto,
  ) {
    return this.platform.listTeachers(req.user, query);
  }
  @Post('teachers') createTeacher(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateTeacherDto,
  ) {
    return this.platform.createTeacherAccount(req.user, dto);
  }
  @Patch('teachers/:id') updateTeacher(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTeacherDto,
  ) {
    return this.platform.updateTeacher(req.user, id, dto);
  }

  @Post('students') createStudent(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateStudentDto,
  ) {
    return this.platform.createStudent(req.user, dto);
  }
  @Get('students') listStudents(
    @Req() req: AuthenticatedRequest,
    @Query() query: StudentQueryDto,
  ) {
    return this.platform.listStudents(req.user, query);
  }
  @Patch('students/:id') updateStudent(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.platform.updateStudent(req.user, id, dto);
  }
  @Post('students/sync') syncStudents(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SyncStudentsDto,
  ) {
    return this.platform.syncStudents(req.user, dto);
  }

  @Post('classrooms') createClassroom(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateClassroomDto,
  ) {
    return this.platform.createClassroom(req.user, dto);
  }
  @Get('classrooms') listClassrooms(@Req() req: AuthenticatedRequest) {
    return this.platform.listClassrooms(req.user);
  }
  @Patch('classrooms/:id') updateClassroom(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateClassroomDto,
  ) {
    return this.platform.updateClassroom(req.user, id, dto);
  }

  @Post('devices') createDevice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateDeviceDto,
  ) {
    return this.platform.createDevice(req.user, dto);
  }
  @Get('devices') listDevices(@Req() req: AuthenticatedRequest) {
    return this.platform.listDevices(req.user);
  }
  @Patch('devices/:id') updateDevice(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.platform.updateDevice(req.user, id, dto);
  }
  @Post('devices/:id/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeviceHeartbeatDto,
  ) {
    return this.platform.heartbeat(req.user, id, dto.deviceCode);
  }
  @Post('device-bindings') bindDevice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: BindDeviceDto,
  ) {
    return this.platform.bindDevice(req.user, dto);
  }
  @Delete('device-bindings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  unbindDevice(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.platform.unbindDevice(req.user, id);
  }
  @Get('devices/context/:deviceCode') deviceContext(
    @Req() req: AuthenticatedRequest,
    @Param() params: DeviceCodeParamDto,
  ) {
    return this.platform.deviceContext(req.user, params.deviceCode);
  }

  @Post('classroom-tickets') createTicket(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateTicketDto,
  ) {
    return this.platform.createTicket(req.user, dto);
  }
  @Post('guardian-consents') upsertConsent(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpsertConsentDto,
  ) {
    return this.platform.upsertConsent(req.user, dto);
  }
  @Get('guardian-consents') listConsents(
    @Req() req: AuthenticatedRequest,
    @Query() query: ConsentQueryDto,
  ) {
    return this.platform.listConsents(req.user, query);
  }

  @Get('audit-logs') listAuditLogs(
    @Req() req: AuthenticatedRequest,
    @Query() query: AuditLogQueryDto,
  ) {
    return this.platform.listAuditLogs(req.user, query);
  }
  @Get('ai-call-logs') listAiCallLogs(
    @Req() req: AuthenticatedRequest,
    @Query() query: PageQueryDto,
  ) {
    return this.platform.listAiCallLogs(req.user, query.page, query.pageSize);
  }

  @Get('admin/dashboard') dashboard(@Req() req: AuthenticatedRequest) {
    return this.platform.adminDashboard(req.user);
  }
}

@Controller('classroom-tickets')
@UseGuards(AuthGuard)
export class ClassroomTicketPublicController {
  constructor(private readonly platform: PlatformService) {}

  @Post('consume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  consume(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConsumeTicketDto,
  ) {
    return this.platform.consumeTicket(req.user, dto.ticket, dto.deviceCode);
  }
}
