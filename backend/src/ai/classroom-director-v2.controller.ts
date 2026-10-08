import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClassroomDirectorV2Service } from './classroom-director-v2.service';
import { ClassroomDirectorRequestDto, DirectorSuggestionDecisionDto, DirectorSuggestionEditDto } from './dto/classroom-director-v2.dto';
import { CommandSynonymService } from './command-synonym.service';
import { CreateCommandSynonymDto } from './dto/command-synonym.dto';

// Keep the original director contract available to existing clients.
@Controller('ai')
@UseGuards(AuthGuard, ThrottlerGuard)
export class ClassroomDirectorV2Controller {
  constructor(private readonly director: ClassroomDirectorV2Service, private readonly synonyms: CommandSynonymService) {}

  @Post('classroom-director-v2')
  @HttpCode(HttpStatus.OK)
  generate(@Req() req: AuthenticatedRequest, @Body() dto: ClassroomDirectorRequestDto) {
    return this.director.generate(req.user, dto);
  }

  @Post('classroom-director-v2/:id/edit')
  @HttpCode(HttpStatus.OK)
  edit(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: DirectorSuggestionEditDto) {
    return this.director.edit(req.user, id, dto);
  }

  @Post('classroom-director-v2/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: DirectorSuggestionDecisionDto) {
    return this.director.confirm(req.user, id, dto);
  }

  @Post('classroom-director-v2/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.director.reject(req.user, id);
  }

  @Get('command-synonyms')
  listSynonyms(@Req() req: AuthenticatedRequest) { return this.synonyms.list(req.user); }

  @Post('command-synonyms')
  createSynonym(@Req() req: AuthenticatedRequest, @Body() dto: CreateCommandSynonymDto) { return this.synonyms.create(req.user, dto); }

  @Delete('command-synonyms/:id')
  removeSynonym(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) { return this.synonyms.remove(req.user, id); }
}
