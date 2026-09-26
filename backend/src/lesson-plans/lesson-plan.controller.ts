import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CreateLessonPlanDto, ListLessonPlansQueryDto, SaveLessonStepsDto, UpdateLessonPlanDto, UpdateLessonRunProgressDto } from './dto/lesson-plan.dto';
import { LessonPlanService } from './lesson-plan.service';

@Controller()
@UseGuards(AuthGuard)
export class LessonPlanController {
  constructor(private readonly service: LessonPlanService) {}
  @Post('lesson-plans') create(@Body() dto: CreateLessonPlanDto, @Req() req: AuthenticatedRequest) { return this.service.create(req.user, dto); }
  @Get('lesson-plans') list(@Query() query: ListLessonPlansQueryDto, @Req() req: AuthenticatedRequest) { return this.service.list(req.user, query); }
  @Get('lesson-plans/:id') get(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.get(req.user, id); }
  @Patch('lesson-plans/:id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLessonPlanDto, @Req() req: AuthenticatedRequest) { return this.service.update(req.user, id, dto); }
  @Delete('lesson-plans/:id') @HttpCode(HttpStatus.NO_CONTENT) remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.remove(req.user, id); }
  @Post('lesson-plans/:id/copy') copy(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.copy(req.user, id); }
  @Put('lesson-plans/:id/steps') steps(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveLessonStepsDto, @Req() req: AuthenticatedRequest) { return this.service.saveSteps(req.user, id, dto); }
  @Post('lesson-plans/:id/start') start(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.start(req.user, id); }
  @Get('lesson-runs/:id') run(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.getRun(req.user, id); }
  @Patch('lesson-runs/:id/progress') progress(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLessonRunProgressDto, @Req() req: AuthenticatedRequest) { return this.service.progress(req.user, id, dto); }
  @Post('lesson-runs/:id/pause') pause(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.pause(req.user, id); }
  @Post('lesson-runs/:id/resume') resume(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.resume(req.user, id); }
  @Post('lesson-runs/:id/complete') complete(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.complete(req.user, id); }
  @Post('lesson-runs/:id/cancel') cancel(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) { return this.service.cancel(req.user, id); }
}
