import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClassroomEngagementService } from './classroom-engagement.service';
import {
  AdjustClassGrowthDto,
  AwardRewardDto,
  BreakOperationDto,
  CreateBadgeDefinitionDto,
  CreateBreakConfigDto,
  CreateCollectiveGoalDto,
  CreateRewardRuleDto,
  PublishHonorDto,
  ReverseRewardDto,
  StartBreakDto,
  SuggestHonorDto,
  UpdateBreakConfigDto,
  UpdateRewardRuleDto,
} from './dto/classroom-engagement.dto';

@Controller()
@UseGuards(AuthGuard)
export class ClassroomEngagementController {
  constructor(private readonly service: ClassroomEngagementService) {}

  @Post('badge-definitions')
  createBadge(
    @Body() dto: CreateBadgeDefinitionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createBadge(request.user, dto);
  }

  @Get('badge-definitions')
  listBadges(@Req() request: AuthenticatedRequest) {
    return this.service.listBadges(request.user);
  }

  @Post('reward-rules')
  createRule(
    @Body() dto: CreateRewardRuleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createRule(request.user, dto);
  }

  @Patch('reward-rules/:id')
  updateRule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRewardRuleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateRule(request.user, id, dto);
  }

  @Get('reward-rules')
  listRules(@Req() request: AuthenticatedRequest) {
    return this.service.listRules(request.user);
  }

  @Post('classroom-runs/:runId/rewards')
  award(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: AwardRewardDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.award(request.user, runId, dto);
  }

  @Get('classroom-runs/:runId/rewards')
  listRewards(
    @Param('runId', ParseIntPipe) runId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listRewards(request.user, runId);
  }

  @Post('rewards/:rewardId/reverse')
  reverseReward(
    @Param('rewardId', ParseIntPipe) rewardId: number,
    @Body() dto: ReverseRewardDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.reverseReward(request.user, rewardId, dto);
  }

  @Get('students/:studentId/badges')
  studentBadges(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.studentBadgeList(request.user, studentId);
  }

  @Post('classes/:classId/collective-goals')
  createGoal(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: CreateCollectiveGoalDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createGoal(request.user, classId, dto);
  }

  @Post('classes/:classId/growth/adjust')
  adjustGrowth(
    @Param('classId', ParseIntPipe) classId: number,
    @Body() dto: AdjustClassGrowthDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.adjustGrowth(request.user, classId, dto);
  }

  @Get('classes/:classId/growth')
  classGrowth(
    @Param('classId', ParseIntPipe) classId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.classGrowth(request.user, classId);
  }

  @Post('classroom-runs/:runId/honors/suggest')
  suggestHonor(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: SuggestHonorDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.suggestHonor(request.user, runId, dto);
  }

  @Post('honors/:honorId/publish')
  publishHonor(
    @Param('honorId', ParseIntPipe) honorId: number,
    @Body() dto: PublishHonorDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.publishHonor(request.user, honorId, dto);
  }

  @Get('classroom-runs/:runId/honors')
  listHonors(
    @Param('runId', ParseIntPipe) runId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listHonors(request.user, runId);
  }

  @Post('break-configs')
  createBreakConfig(
    @Body() dto: CreateBreakConfigDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.createBreakConfig(request.user, dto);
  }

  @Patch('break-configs/:id')
  updateBreakConfig(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBreakConfigDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateBreakConfig(request.user, id, dto);
  }

  @Get('classes/:classId/break-configs')
  listBreakConfigs(
    @Param('classId', ParseIntPipe) classId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listBreakConfigs(request.user, classId);
  }

  @Post('classroom-runs/:runId/breaks/start')
  startBreak(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: StartBreakDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.startBreak(request.user, runId, dto);
  }

  @Get('classroom-runs/:runId/breaks/active')
  activeBreak(
    @Param('runId', ParseIntPipe) runId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.activeBreak(request.user, runId);
  }

  @Get('break-runs/:id')
  getBreak(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getBreak(request.user, id);
  }

  @Post('break-runs/:id/pause')
  pauseBreak(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BreakOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.pauseBreak(request.user, id, dto);
  }

  @Post('break-runs/:id/resume')
  resumeBreak(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BreakOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.resumeBreak(request.user, id, dto);
  }

  @Post('break-runs/:id/end')
  endBreak(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BreakOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.endBreak(request.user, id, dto);
  }
}
