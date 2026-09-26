import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { CheckIn } from './entities/check-in.entity';
import { EmotionEvent } from './entities/emotion-event.entity';
import { TeachingResource } from './entities/teaching-resource.entity';
import { OwnerType } from './owner.types';

type ActivityRecord = {
  ownerId: string;
  activityAt: Date | string;
};

@Injectable()
export class VisitorCleanupService {
  private readonly logger = new Logger(VisitorCleanupService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(EmotionEvent)
    private readonly emotionRepository: Repository<EmotionEvent>,
    @InjectRepository(CheckIn)
    private readonly checkInRepository: Repository<CheckIn>,
    @InjectRepository(TeachingResource)
    private readonly resourceRepository: Repository<TeachingResource>,
  ) {}

  @Cron('0 0 3 * * *', {
    name: 'cleanup-expired-visitors',
    timeZone: 'Asia/Shanghai',
    waitForCompletion: true,
  })
  async handleDailyCleanup(): Promise<void> {
    const deletedOwners = await this.cleanupExpiredVisitors();
    this.logger.log(`游客临时数据清理完成，删除 ${deletedOwners} 个过期游客`);
  }

  async findExpiredVisitorIds(referenceDate = new Date()): Promise<string[]> {
    const retentionDays = this.getRetentionDays();
    const cutoff =
      referenceDate.getTime() - retentionDays * 24 * 60 * 60 * 1000;
    const activityByOwner = new Map<string, number>();

    const recordGroups = await Promise.all([
      this.getActivities(this.sessionRepository, 'lastActiveAt'),
      this.getActivities(this.messageRepository, 'createdAt'),
      this.getActivities(this.emotionRepository, 'createdAt'),
      this.getActivities(this.checkInRepository, 'checkInAt'),
      this.getActivities(this.resourceRepository, 'updatedAt'),
    ]);

    for (const records of recordGroups) {
      for (const record of records) {
        const timestamp = new Date(record.activityAt).getTime();
        const previous = activityByOwner.get(record.ownerId) ?? 0;
        if (Number.isFinite(timestamp) && timestamp > previous) {
          activityByOwner.set(record.ownerId, timestamp);
        }
      }
    }

    return [...activityByOwner.entries()]
      .filter(([, lastActiveAt]) => lastActiveAt < cutoff)
      .map(([ownerId]) => ownerId);
  }

  async cleanupExpiredVisitors(referenceDate = new Date()): Promise<number> {
    const expiredOwnerIds = await this.findExpiredVisitorIds(referenceDate);
    if (expiredOwnerIds.length === 0) {
      return 0;
    }

    await this.dataSource.transaction(async (manager) => {
      const criteria = {
        ownerType: OwnerType.Visitor,
        ownerId: In(expiredOwnerIds),
      };
      await manager.delete(ChatMessage, criteria);
      await manager.delete(EmotionEvent, criteria);
      await manager.delete(CheckIn, criteria);
      await manager.delete(TeachingResource, criteria);
      await manager.delete(ChatSession, criteria);
    });

    return expiredOwnerIds.length;
  }

  private async getActivities<T extends object>(
    repository: Repository<T>,
    activityProperty: string,
  ): Promise<ActivityRecord[]> {
    return repository
      .createQueryBuilder('record')
      .select('record.ownerId', 'ownerId')
      .addSelect(`record.${activityProperty}`, 'activityAt')
      .where('record.ownerType = :ownerType', {
        ownerType: OwnerType.Visitor,
      })
      .getRawMany<ActivityRecord>();
  }

  private getRetentionDays(): number {
    const value = Number(
      this.configService.get<string>('VISITOR_RETENTION_DAYS') || '14',
    );
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('VISITOR_RETENTION_DAYS 必须是大于 0 的整数');
    }
    return value;
  }
}
