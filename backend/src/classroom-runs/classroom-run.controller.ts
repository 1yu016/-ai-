import {
  Body,
  Controller,
  Get,
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
import { StudentRewardService } from './student-reward.service';
import {
  ChangeClassroomStepDto,
  ActiveClassroomRunsQueryDto,
  ClassroomCheckpointDto,
  ClassroomRunOperationDto,
  CreateClassroomRewardDto,
  RecoverClassroomRunDto,
  RestoreClassroomRunQueryDto,
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
