import {
  Body,
  Controller,
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
import {
  ClassQuestionQueryDto,
  CreateStudentQuestionDto,
  QuestionMapQueryDto,
  UpdateStudentQuestionDto,
} from './dto/student-question.dto';
import { StudentQuestionService } from './student-question.service';

@Controller()
@UseGuards(AuthGuard)
export class StudentQuestionController {
  constructor(private readonly questions: StudentQuestionService) {}

  @Post('classroom-runs/:runId/questions')
  create(
    @Param('runId', ParseIntPipe) runId: number,
    @Body() dto: CreateStudentQuestionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.questions.create(request.user, runId, dto);
  }

  @Get('classroom-runs/:runId/questions')
  listRun(
    @Param('runId', ParseIntPipe) runId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.questions.listRun(request.user, runId);
  }

  @Patch('classroom-runs/:runId/questions/:questionId')
  update(
    @Param('runId', ParseIntPipe) runId: number,
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() dto: UpdateStudentQuestionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.questions.update(request.user, runId, questionId, dto);
  }

  @Get('classes/:classId/questions')
  listClass(
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: ClassQuestionQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.questions.listClass(request.user, classId, query);
  }

  @Get('classes/:classId/question-map')
  map(
    @Param('classId', ParseIntPipe) classId: number,
    @Query() query: QuestionMapQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.questions.map(request.user, classId, query);
  }
}
