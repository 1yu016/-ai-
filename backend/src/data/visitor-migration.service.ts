import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityTarget } from 'typeorm';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { CheckIn } from './entities/check-in.entity';
import { EmotionEvent } from './entities/emotion-event.entity';
import { TeachingResource } from './entities/teaching-resource.entity';
import { VisitorMigration } from './entities/visitor-migration.entity';
import { OwnerType } from './owner.types';

export type VisitorMigrationResult =
  | { success: true; migratedCount: number }
  | { success: false; message: string };

const OWNED_ENTITIES: EntityTarget<
  ChatSession | ChatMessage | EmotionEvent | CheckIn | TeachingResource
>[] = [ChatSession, ChatMessage, EmotionEvent, CheckIn, TeachingResource];

const ALREADY_MIGRATED_MESSAGE = '该游客数据已经迁移过，不可重复绑定';

@Injectable()
export class VisitorMigrationService {
  private migrationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(VisitorMigration)
    private readonly migrationRepository: Repository<VisitorMigration>,
  ) {}

  async migrate(
    visitorId: string,
    teacherId: number,
  ): Promise<VisitorMigrationResult> {
    const normalizedVisitorId = visitorId.trim();
    const normalizedTeacherId = String(teacherId);
    const previousMigration = this.migrationQueue;
    let releaseMigration: () => void = () => undefined;
    this.migrationQueue = new Promise<void>((resolve) => {
      releaseMigration = resolve;
    });
    await previousMigration;

    try {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const existingMigration = await manager.findOneBy(VisitorMigration, {
            visitorId: normalizedVisitorId,
          });
          if (existingMigration) {
            return { success: false, message: ALREADY_MIGRATED_MESSAGE };
          }

          let visitorRowCount = 0;
          for (const entity of OWNED_ENTITIES) {
            visitorRowCount += await manager.count(entity, {
              where: {
                ownerType: OwnerType.Visitor,
                ownerId: normalizedVisitorId,
              },
            });
          }

          if (visitorRowCount === 0) {
            return { success: true, migratedCount: 0 };
          }

          await manager.insert(VisitorMigration, {
            visitorId: normalizedVisitorId,
            teacherId: normalizedTeacherId,
          });

          let migratedCount = 0;
          for (const entity of OWNED_ENTITIES) {
            const result = await manager.update(
              entity,
              {
                ownerType: OwnerType.Visitor,
                ownerId: normalizedVisitorId,
              },
              {
                ownerType: OwnerType.Teacher,
                ownerId: normalizedTeacherId,
              },
            );
            migratedCount += result.affected ?? 0;
          }

          return { success: true, migratedCount };
        });
      } catch (error) {
        if (this.isDuplicateMigrationError(error)) {
          return { success: false, message: ALREADY_MIGRATED_MESSAGE };
        }
        throw error;
      }
    } finally {
      releaseMigration();
    }
  }

  private isDuplicateMigrationError(error: unknown): boolean {
    const candidate = error as {
      code?: string;
      message?: string;
      driverError?: { code?: string; message?: string };
    };
    const code = candidate.driverError?.code ?? candidate.code;
    const message = candidate.driverError?.message ?? candidate.message ?? '';
    return (
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      message.includes('visitor_migration.visitor_id')
    );
  }
}
