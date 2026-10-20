import { Body, Controller, Param, ParseIntPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ClassroomDialogueService } from './classroom-dialogue.service';
import { ClassroomDialogueDto } from './dto/classroom-dialogue.dto';
import { ThrottlerGuard } from '@nestjs/throttler';

@Controller('classroom-runs')
@UseGuards(AuthGuard, ThrottlerGuard)
export class ClassroomDialogueController {
  constructor(private readonly dialogue: ClassroomDialogueService) {}
  @Post(':id/dialogue')
  async reply(@Req() request: AuthenticatedRequest, @Res() response: Response, @Param('id', ParseIntPipe) id: number, @Body() dto: ClassroomDialogueDto) {
    // Reject authorization/context errors before opening the response stream.
    await this.dialogue.context(request.user, id, dto.stepIndex);
    const abort = new AbortController();
    const close = () => abort.abort(); response.once('close', close);
    const timeout = setTimeout(close, 45_000);
    response.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    try {
      for await (const event of this.dialogue.reply(request.user, id, dto, abort.signal)) {
        if (abort.signal.aborted || response.destroyed) break;
        response.write(JSON.stringify(event) + '\n');
      }
      if (abort.signal.aborted && !response.destroyed) response.write(JSON.stringify({ type: 'error', code: 'DIALOGUE_INTERRUPTED', message: '回答已中断，可手动重新提问。' }) + '\n');
    } catch {
      if (!response.destroyed) response.write(JSON.stringify({ type: 'error', code: 'DIALOGUE_INTERRUPTED', message: '回答未完成或课堂已变化，请老师接手。不会自动重试。' }) + '\n');
    } finally { clearTimeout(timeout); response.off('close', close); response.end(); }
  }
}
