import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClassroomRunService } from './classroom-run.service';
import { AttendanceService } from './attendance.service';
import { VoiceAttendanceCandidatesDto } from './dto/attendance.dto';
import { StudentRewardService } from './student-reward.service';
import {
  ChangeClassroomStepDto,
  ActiveClassroomRunsQueryDto,
  ClassroomScreenStateQueryDto,
  ClassroomCheckpointDto,
  ClassroomRunOperationDto,
  CreateClassroomRewardDto,
  CreateCollectiveRewardDto,
  CreateGrowthGoalDto,
  RevokeRewardDto,
  EndClassroomBreakDto,
  RecoverClassroomRunDto,
  RestoreClassroomRunQueryDto,
  StartClassroomBreakDto,
  StartClassroomRunDto,
  TakeoverClassroomRunDto,
  SetClassroomAvatarBindingDto,
  CancelClassroomAvatarBindingDto,
} from './dto/classroom-run.dto';

@Controller('classroom-runs')
@UseGuards(AuthGuard)
export class ClassroomRunController {
  constructor(
    private readonly service: ClassroomRunService,
    private readonly rewardService: StudentRewardService,
    private readonly attendanceService: AttendanceService,
  ) {}

  @Post('start')
  start(
    @Body() dto: StartClassroomRunDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.start(request.user, dto);
  }

  @Get('active')
  active(
    @Query() query: ActiveClassroomRunsQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.active(request.user, query.deviceId);
  }

  @Get('screen-state')
  screenState(
    @Query() query: ClassroomScreenStateQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.screenState(request.user, query.deviceId);
  }

  @Get(':id/restore')
  restore(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: RestoreClassroomRunQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.restore(request.user, id, query.deviceId);
  }

  @Get(':id')
  get(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(request.user, id);
  }

  @Post(':id/pause')
  pause(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClassroomRunOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.pause(request.user, id, dto);
  }

  @Post(':id/resume')
  resume(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClassroomRunOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.resume(request.user, id, dto);
  }

  @Post(':id/complete')
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClassroomRunOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.complete(request.user, id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClassroomRunOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.cancel(request.user, id, dto);
  }

  @Post(':id/break')
  startBreak(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartClassroomBreakDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.startBreak(request.user, id, dto);
  }

  @Post(':id/break/end')
  @HttpCode(HttpStatus.OK)
  endBreak(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EndClassroomBreakDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.endBreak(request.user, id, dto);
  }

  @Post(':id/steps/:stepIndex')
  changeStep(
    @Param('id', ParseIntPipe) id: number,
    @Param('stepIndex', ParseIntPipe) stepIndex: number,
    @Body() dto: ClassroomRunOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = Object.assign(new ChangeClassroomStepDto(), dto, {
      stepIndex,
    });
    return this.service.changeStep(request.user, id, input);
  }

  @Post(':id/takeover')
  takeover(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TakeoverClassroomRunDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.takeover(request.user, id, dto);
  }

  @Post(':id/recover')
  recover(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecoverClassroomRunDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.recover(request.user, id, dto);
  }

  @Post(':id/checkpoints')
  checkpoint(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClassroomCheckpointDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.checkpoint(request.user, id, dto);
  }

  @Post(':id/rewards')
  createReward(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateClassroomRewardDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rewardService.createReward(request.user, id, dto);
  }

  @Get(':id/rewards')
  listRewards(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rewardService.listRunRewards(request.user, id);
  }

  @Post(':id/rewards/:rewardId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeReward(
    @Param('id', ParseIntPipe) id: number,
    @Param('rewardId', ParseIntPipe) rewardId: number,
    @Body() dto: RevokeRewardDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rewardService.revokeReward(request.user, id, rewardId, dto.requestId, dto.reason);
  }

  @Get(':id/reward-dashboard')
  rewardDashboard(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rewardService.rewardDashboard(request.user, id);
  }

  @Post(':id/growth-goals')
  createGrowthGoal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGrowthGoalDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rewardService.createGrowthGoal(request.user, id, dto);
  }

  @Post(':id/collective-rewards')
  createCollectiveReward(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCollectiveRewardDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rewardService.createCollectiveReward(request.user, id, dto);
  }

  @Post(':id/collective-rewards/:rewardId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeCollectiveReward(
    @Param('id', ParseIntPipe) id: number,
    @Param('rewardId', ParseIntPipe) rewardId: number,
    @Body() dto: RevokeRewardDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rewardService.revokeCollectiveReward(request.user, id, rewardId, dto.requestId, dto.reason);
  }

  @Get(':id/attendance')
  listAttendance(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attendanceService.list(request.user, id);
  }

  @Post(':id/attendance/voice-candidates')
  voiceAttendanceCandidates(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoiceAttendanceCandidatesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attendanceService.voiceCandidates(request.user, id, dto.transcript);
  }

  @Post(':id/avatar-binding')
  setAvatarBinding(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetClassroomAvatarBindingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.setAvatarBinding(request.user, id, dto);
  }

  @Post(':id/avatar-binding/cancel')
  cancelAvatarBinding(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelClassroomAvatarBindingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.cancelAvatarBinding(request.user, id, dto);
  }
}
