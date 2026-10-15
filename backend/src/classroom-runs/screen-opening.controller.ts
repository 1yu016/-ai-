import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ScreenLifecycleService } from './screen-lifecycle.service';
import { ScreenOpeningOperationDto } from './dto/screen-opening.dto';
import { ScreenHandoffService } from './screen-handoff.service';

@Controller('classroom-runs')
@UseGuards(AuthGuard)
export class ScreenOpeningController {
  constructor(
    private readonly lifecycle: ScreenLifecycleService,
    private readonly handoffs: ScreenHandoffService,
  ) {}
  @Post(':id/summary/close')
  async closeSummary(
    @Param('id', ParseIntPipe) runId: number,
    @Body() dto: ScreenOpeningOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const state = await this.lifecycle.closeSummary(request.user, {
      ...dto,
      runId,
    });
    this.handoffs.revokeRun(runId);
    return state;
  }
  @Post(':id/opening/complete')
  complete(
    @Param('id', ParseIntPipe) runId: number,
    @Body() dto: ScreenOpeningOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.completeOpening(request.user, { ...dto, runId });
  }
  @Post(':id/opening/skip')
  skip(
    @Param('id', ParseIntPipe) runId: number,
    @Body() dto: ScreenOpeningOperationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycle.skipOpening(request.user, { ...dto, runId });
  }
}
