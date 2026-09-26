import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatPersistenceService } from './chat-persistence.service';
import { DataController } from './data.controller';
import { EmotionController } from './emotion.controller';
import { EmotionService } from './emotion.service';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { CheckIn } from './entities/check-in.entity';
import { EmotionEvent } from './entities/emotion-event.entity';
import { TeachingResource } from './entities/teaching-resource.entity';
import { VisitorMigration } from './entities/visitor-migration.entity';
import { VisitorCleanupService } from './visitor-cleanup.service';
import { VisitorMigrationService } from './visitor-migration.service';

export const DATA_ENTITIES = [
  ChatSession,
  ChatMessage,
  EmotionEvent,
  CheckIn,
  TeachingResource,
  VisitorMigration,
];

@Module({
  imports: [TypeOrmModule.forFeature(DATA_ENTITIES), AuthModule],
  controllers: [DataController, EmotionController],
  providers: [
    ChatPersistenceService,
    EmotionService,
    VisitorCleanupService,
    VisitorMigrationService,
  ],
  exports: [
    TypeOrmModule,
    ChatPersistenceService,
    EmotionService,
    VisitorCleanupService,
    VisitorMigrationService,
  ],
})
export class DataModule {}
