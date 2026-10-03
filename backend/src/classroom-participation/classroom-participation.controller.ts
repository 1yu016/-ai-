import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClassroomParticipationService } from './classroom-participation.service';
import {
  AttendanceHistoryQueryDto,
  BatchAttendanceDto,
  ConfirmVoiceAttendanceDto,
  CreateStudentGroupDto,
  GroupMemberDto,
  RandomGroupingDto,
  RollCallDto,
  SetAttendanceDto,
  UpdateStudentGroupDto,
  VoiceAttendanceRecognizeDto,
} from './dto/classroom-participation.dto';

@Controller('classroom-runs')
@UseGuards(AuthGuard)
export class ClassroomParticipationController {
  constructor(private readonly service: ClassroomParticipationService) {}

  @Post(':runId/attendance')
  setAttendance(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: SetAttendanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.setAttendance(request.user, runId, dto);
  }

  @Post(':runId/attendance/batch')
  batchAttendance(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: BatchAttendanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.batchAttendance(request.user, runId, dto);
  }

  @Get(':runId/attendance')
  listAttendance(
    @Param('runId', ParseIntPipe) runId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listAttendance(request.user, runId);
  }

  @Get(':runId/attendance/change-logs')
  attendanceChangeLogs(
    @Param('runId', ParseIntPipe) runId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.attendanceChangeLogs(request.user, runId);
  }

  @Post(':runId/attendance/voice/recognize')
  recognizeVoice(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: VoiceAttendanceRecognizeDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.recognizeVoice(request.user, runId, dto);
  }

  @Post(':runId/attendance/voice/confirm')
  confirmVoice(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: ConfirmVoiceAttendanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.confirmVoice(request.user, runId, dto);
  }

  @Post(':runId/groups')
  createGroup(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: CreateStudentGroupDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createGroup(request.user, runId, dto);
  }

  @Get(':runId/groups')
  listGroups(
    @Param('runId', ParseIntPipe) runId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listGroups(request.user, runId);
  }

  @Patch(':runId/groups/:groupId')
  updateGroup(
    @Param('runId', ParseIntPipe) runId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: UpdateStudentGroupDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateGroup(request.user, runId, groupId, dto);
  }

  @Delete(':runId/groups/:groupId')
  deleteGroup(
    @Param('runId', ParseIntPipe) runId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.deleteGroup(request.user, runId, groupId);
  }

  @Post(':runId/groups/:groupId/members')
  addGroupMember(
    @Param('runId', ParseIntPipe) runId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: GroupMemberDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.addGroupMember(request.user, runId, groupId, dto);
  }

  @Delete(':runId/groups/:groupId/members/:studentId')
  removeGroupMember(
    @Param('runId', ParseIntPipe) runId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.removeGroupMember(
      request.user,
      runId,
      groupId,
      studentId,
    );
  }

  @Post(':runId/groups/random')
  randomGroups(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: RandomGroupingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.randomGroups(request.user, runId, dto);
  }

  @Post(':runId/roll-calls')
  rollCall(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: RollCallDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.rollCall(request.user, runId, dto);
  }

  @Get(':runId/roll-calls')
  listRollCalls(
    @Param('runId', ParseIntPipe) runId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listRollCalls(request.user, runId);
  }
}

@Controller('students')
@UseGuards(AuthGuard)
export class StudentAttendanceController {
  constructor(private readonly service: ClassroomParticipationService) {}

  @Get(':studentId/attendance-history')
  history(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: AttendanceHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.attendanceHistory(request.user, studentId, query);
  }
}
