import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClassroomRecordService } from './classroom-record.service';
import {
  ConfirmClassroomSummaryDto,
  DiscardClassroomSummaryDto,
} from './dto/classroom-record.dto';

@Controller('classroom-runs')
@UseGuards(AuthGuard)
export class ClassroomRecordController {
  constructor(private readonly records: ClassroomRecordService) {}

  @Get(':id/timeline')
  timeline(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.records.timeline(request.user, id);
  }

  @Post(':id/summary/draft')
  draft(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.records.ensureDraft(request.user, id);
  }

  @Get(':id/summary')
  summary(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.records.getSummary(request.user, id);
  }

  @Post(':id/summary/confirm')
  confirm(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmClassroomSummaryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.records.confirm(request.user, id, dto);
  }

  @Post(':id/summary/discard')
  discard(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DiscardClassroomSummaryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.records.discard(request.user, id, dto.reason);
  }

  @Get(':id/report')
  report(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.records.report(request.user, id);
  }
}
