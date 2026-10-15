import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { LessonEvidenceService } from './lesson-evidence.service';
import { BuildEvidencePackDto, ReferenceRunsQueryDto } from './dto/lesson-evidence.dto';

@Controller('lesson-plans')
@UseGuards(AuthGuard)
export class LessonEvidenceController {
  constructor(private readonly evidence: LessonEvidenceService) {}
  @Get(':id/reference-runs')
  list(@Param('id',ParseIntPipe) id:number,@Query() query:ReferenceRunsQueryDto,@Req() request:AuthenticatedRequest) {
    return this.evidence.list(request.user,id,query);
  }
  @Post(':id/evidence-pack')
  build(@Param('id',ParseIntPipe) id:number,@Body() input:BuildEvidencePackDto,@Req() request:AuthenticatedRequest) {
    return this.evidence.build(request.user,id,input);
  }
}
