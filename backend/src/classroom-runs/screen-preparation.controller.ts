import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ScreenPreparationService } from './screen-preparation.service';
import { CancelScreenPreparationDto, CreateScreenPreparationDto } from './dto/screen-preparation.dto';

@Controller('devices/:deviceId/screen-preparations')
@UseGuards(AuthGuard)
export class ScreenPreparationController {
  constructor(private readonly preparations: ScreenPreparationService) {}
  @Post()
  create(@Req() req: AuthenticatedRequest, @Param('deviceId', ParseIntPipe) deviceId: number, @Body() dto: CreateScreenPreparationDto) {
    return this.preparations.create(req.user, deviceId, dto);
  }
  @Get()
  get(@Req() req: AuthenticatedRequest, @Param('deviceId', ParseIntPipe) deviceId: number) {
    return this.preparations.get(req.user, deviceId);
  }
  @Delete(':preparationId')
  cancel(@Req() req: AuthenticatedRequest, @Param('deviceId', ParseIntPipe) deviceId: number, @Param('preparationId') id: string, @Query() query: CancelScreenPreparationDto) {
    return this.preparations.cancel(req.user, deviceId, id, query.revision);
  }
}
