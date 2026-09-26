import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { OptionallyAuthenticatedRequest } from '../auth/auth.types';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ReportEmotionDto } from './dto/report-emotion.dto';
import { EmotionService } from './emotion.service';
import { requireDataOwner } from './owner.types';

@Controller('emotion')
export class EmotionController {
  constructor(private readonly emotionService: EmotionService) {}

  @Post('report')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalAuthGuard, ThrottlerGuard)
  report(
    @Body() dto: ReportEmotionDto,
    @Req() request: OptionallyAuthenticatedRequest,
  ): Promise<{ id: number }> {
    const owner = requireDataOwner(request.user, dto.visitorId);
    return this.emotionService.report(owner, dto);
  }
}
