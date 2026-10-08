import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClassroomCommandService } from './classroom-command.service';
import { ExecuteClassroomCommandDto } from './dto/classroom-command.dto';

@Controller('classroom-commands')
@UseGuards(AuthGuard)
export class ClassroomCommandController {
  constructor(private readonly commands: ClassroomCommandService) {}

  @Post()
  execute(
    @Body() dto: ExecuteClassroomCommandDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commands.execute(request.user, dto);
  }

  @Get(':requestId')
  findOne(
    @Param('requestId') requestId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.commands.findOne(request.user, requestId);
  }
}
