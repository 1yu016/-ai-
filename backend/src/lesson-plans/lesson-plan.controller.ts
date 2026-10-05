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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  AddLessonStepDto,
  AiLessonPlanDraftRequestDto,
  ConfirmAiLessonDraftDto,
  CreateLessonPlanDto,
  DeleteLessonStepDto,
  ListLessonPlansQueryDto,
  ReorderLessonStepsDto,
  SaveLessonStepsDto,
  UpdateLessonPlanDto,
  UpdateLessonRunProgressDto,
  UpdateLessonStepDto,
} from './dto/lesson-plan.dto';
import { LessonPlanService } from './lesson-plan.service';

@Controller()
@UseGuards(AuthGuard)
export class LessonPlanController {
  constructor(private readonly service: LessonPlanService) {}

  @Post('lesson-plans')
  create(
    @Body() dto: CreateLessonPlanDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(request.user, dto);
  }

  @Get('lesson-plans')
  list(
    @Query() query: ListLessonPlansQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(request.user, query);
  }

  @Post('lesson-plans/ai-drafts')
  generateAiDraft(
    @Body() dto: AiLessonPlanDraftRequestDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.generateAiDraft(request.user, dto);
  }

  @Get('lesson-plans/ai-drafts/:id')
  getAiDraft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getAiDraft(request.user, id);
  }

  @Post('lesson-plans/ai-drafts/:id/confirm')
  confirmAiDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmAiLessonDraftDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.confirmAiDraft(request.user, id, dto);
  }

  @Get('lesson-plans/:id')
  get(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(request.user, id);
  }

  @Get('lesson-plans/:id/versions')
  listVersions(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.listVersions(request.user, id);
  }

  @Patch('lesson-plans/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLessonPlanDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.update(request.user, id, dto);
  }

  @Delete('lesson-plans/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.remove(request.user, id);
  }

  @Post('lesson-plans/:id/copy')
  copy(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.copy(request.user, id);
  }

  @Put('lesson-plans/:id/steps')
  steps(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveLessonStepsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.saveSteps(request.user, id, dto);
  }

  @Post('lesson-plans/:id/steps')
  addStep(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddLessonStepDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.addStep(request.user, id, dto);
  }

  @Patch('lesson-plans/:id/steps/:stepId')
  updateStep(
    @Param('id', ParseIntPipe) id: number,
    @Param('stepId', ParseIntPipe) stepId: number,
    @Body() dto: UpdateLessonStepDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.updateStep(request.user, id, stepId, dto);
  }

  @Delete('lesson-plans/:id/steps/:stepId')
  deleteStep(
    @Param('id', ParseIntPipe) id: number,
    @Param('stepId', ParseIntPipe) stepId: number,
    @Body() dto: DeleteLessonStepDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.deleteStep(request.user, id, stepId, dto);
  }

  @Post('lesson-plans/:id/steps/:stepId/copy')
  copyStep(
    @Param('id', ParseIntPipe) id: number,
    @Param('stepId', ParseIntPipe) stepId: number,
    @Body() dto: DeleteLessonStepDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.copyStep(request.user, id, stepId, dto);
  }

  @Put('lesson-plans/:id/steps-order')
  reorderSteps(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderLessonStepsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.reorderSteps(request.user, id, dto);
  }

  // 以下仅保留既有课堂运行接口，不在阶段三扩展其能力。
  @Post('lesson-plans/:id/start')
  start(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.start(request.user, id);
  }

  @Get('lesson-runs/:id')
  run(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.getRun(request.user, id);
  }

  @Patch('lesson-runs/:id/progress')
  progress(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLessonRunProgressDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.progress(request.user, id, dto);
  }

  @Post('lesson-runs/:id/pause')
  pause(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.pause(request.user, id);
  }

  @Post('lesson-runs/:id/resume')
  resume(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.resume(request.user, id);
  }

  @Post('lesson-runs/:id/complete')
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.complete(request.user, id);
  }

  @Post('lesson-runs/:id/cancel')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.cancel(request.user, id);
  }
}
