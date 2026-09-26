import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ReportEmotionDto } from './dto/report-emotion.dto';
import { EmotionEvent } from './entities/emotion-event.entity';
import type { DataOwner } from './owner.types';
import { ChatPersistenceService } from './chat-persistence.service';

@Injectable()
export class EmotionService {
  constructor(
    @InjectRepository(EmotionEvent)
    private readonly emotionRepository: Repository<EmotionEvent>,
    private readonly chatPersistenceService: ChatPersistenceService,
  ) {}

  async report(
    owner: DataOwner,
    dto: ReportEmotionDto,
  ): Promise<{ id: number }> {
    if (
      dto.sessionId &&
      !(await this.chatPersistenceService.sessionBelongsToOwner(
        dto.sessionId,
        owner,
      ))
    ) {
      throw new NotFoundException('会话不存在或不属于当前用户');
    }

    const event = await this.emotionRepository.save(
      this.emotionRepository.create({
        ...owner,
        sessionId: dto.sessionId ?? null,
        emotion: dto.emotion.trim(),
        intensity: dto.intensity ?? null,
      }),
    );
    return { id: event.id };
  }
}
