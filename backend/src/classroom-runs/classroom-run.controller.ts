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
import { ClassroomRunService } from './classroom-run.service';
import {
  ChangeClassroomStepDto,
  ClassroomRunOperationDto,
  StartClassroomRunDto,
} from './dto/classroom-run.dto';

@Controller('classroom-runs')
@UseGuards(AuthGuard)
export class ClassroomRunController {
  constructor(private readonly service: ClassroomRunService) {}

  @Post('start')
  start(
    @Body() dto: StartClassroomRunDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.start(request.user, dto);
  }

  @Get('active')
  active(@Req() request: AuthenticatedRequest) {
    return this.service.active(request.user);
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
}
