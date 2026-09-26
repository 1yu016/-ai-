import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { ChatPersistenceService } from './chat-persistence.service';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { CheckIn } from './entities/check-in.entity';
import { EmotionEvent } from './entities/emotion-event.entity';
import { TeachingResource } from './entities/teaching-resource.entity';
import { VisitorMigration } from './entities/visitor-migration.entity';
import { OwnerType } from './owner.types';
import { VisitorCleanupService } from './visitor-cleanup.service';
import { VisitorMigrationService } from './visitor-migration.service';

const ENTITIES = [
  ChatSession,
  ChatMessage,
  EmotionEvent,
  CheckIn,
  TeachingResource,
  VisitorMigration,
];

describe('phase 2 data services', () => {
  let module: TestingModule;
  let persistence: ChatPersistenceService;
  let cleanup: VisitorCleanupService;
  let migration: VisitorMigrationService;
  let sessionRepository: Repository<ChatSession>;
  let messageRepository: Repository<ChatMessage>;
  let emotionRepository: Repository<EmotionEvent>;
  let checkInRepository: Repository<CheckIn>;
  let resourceRepository: Repository<TeachingResource>;
  let migrationRepository: Repository<VisitorMigration>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: ENTITIES,
          synchronize: true,
        }),
        TypeOrmModule.forFeature(ENTITIES),
      ],
      providers: [
        ChatPersistenceService,
        VisitorCleanupService,
        VisitorMigrationService,
        {
          provide: ConfigService,
          useValue: { get: () => '14' },
        },
      ],
    }).compile();

    persistence = module.get(ChatPersistenceService);
    cleanup = module.get(VisitorCleanupService);
    migration = module.get(VisitorMigrationService);
    sessionRepository = module.get(getRepositoryToken(ChatSession));
    messageRepository = module.get(getRepositoryToken(ChatMessage));
    emotionRepository = module.get(getRepositoryToken(EmotionEvent));
    checkInRepository = module.get(getRepositoryToken(CheckIn));
    resourceRepository = module.get(getRepositoryToken(TeachingResource));
    migrationRepository = module.get(getRepositoryToken(VisitorMigration));
  });

  afterAll(async () => module.close());

  beforeEach(async () => {
    const dataSource = module.get(DataSource);
    await dataSource.transaction(async (manager) => {
      await manager.clear(ChatMessage);
      await manager.clear(EmotionEvent);
      await manager.clear(CheckIn);
      await manager.clear(TeachingResource);
      await manager.clear(ChatSession);
      await manager.clear(VisitorMigration);
    });
  });

  it('stores visitor and teacher chat exchanges under the correct owner', async () => {
    const visitorSessionId = await persistence.saveExchange(
      { ownerType: OwnerType.Visitor, ownerId: 'visitor-integration-001' },
      { text: '你好', reply: '你好呀' },
    );
    const teacherSessionId = await persistence.saveExchange(
      { ownerType: OwnerType.Teacher, ownerId: '42' },
      { text: '教师问题', reply: '教师回答' },
    );

    await expect(
      sessionRepository.findOneByOrFail({ id: visitorSessionId }),
    ).resolves.toMatchObject({
      ownerType: OwnerType.Visitor,
      ownerId: 'visitor-integration-001',
    });
    await expect(
      sessionRepository.findOneByOrFail({ id: teacherSessionId }),
    ).resolves.toMatchObject({
      ownerType: OwnerType.Teacher,
      ownerId: '42',
    });

    const visitorMessages = await messageRepository.findBy({
      sessionId: visitorSessionId,
    });
    expect(visitorMessages).toHaveLength(2);
    expect(visitorMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerType: OwnerType.Visitor,
          ownerId: 'visitor-integration-001',
        }),
      ]),
    );
  });

  it('deletes only visitors whose latest activity is older than 14 days', async () => {
    const now = new Date('2026-09-21T12:00:00.000Z');
    const oldDate = new Date('2026-09-01T12:00:00.000Z');
    const freshDate = new Date('2026-09-20T12:00:00.000Z');
    const oldVisitor = { ownerType: OwnerType.Visitor, ownerId: 'visitor-old' };
    const freshVisitor = {
      ownerType: OwnerType.Visitor,
      ownerId: 'visitor-fresh',
    };
    const teacher = { ownerType: OwnerType.Teacher, ownerId: '7' };

    const oldSession = await sessionRepository.save(
      sessionRepository.create({
        ...oldVisitor,
        title: '旧游客',
        lastActiveAt: oldDate,
      }),
    );
    await messageRepository.save(
      messageRepository.create({
        ...oldVisitor,
        sessionId: oldSession.id,
        role: 'user',
        content: '旧消息',
        createdAt: oldDate,
      }),
    );
    await emotionRepository.save(
      emotionRepository.create({
        ...oldVisitor,
        sessionId: oldSession.id,
        emotion: 'happy',
        intensity: 5,
        createdAt: oldDate,
      }),
    );
    await checkInRepository.save(
      checkInRepository.create({ ...oldVisitor, checkInAt: oldDate }),
    );
    const oldResource = await resourceRepository.save(
      resourceRepository.create({
        ...oldVisitor,
        title: '旧资源',
        type: 'image',
        url: null,
      }),
    );
    await resourceRepository.update(oldResource.id, { updatedAt: oldDate });

    await sessionRepository.save(
      sessionRepository.create({
        ...freshVisitor,
        title: '活跃游客',
        lastActiveAt: freshDate,
      }),
    );
    await sessionRepository.save(
      sessionRepository.create({
        ...teacher,
        title: '教师旧数据',
        lastActiveAt: oldDate,
      }),
    );

    await expect(cleanup.findExpiredVisitorIds(now)).resolves.toEqual([
      'visitor-old',
    ]);
    await expect(cleanup.cleanupExpiredVisitors(now)).resolves.toBe(1);

    await expect(
      sessionRepository.countBy({ ownerId: 'visitor-old' }),
    ).resolves.toBe(0);
    await expect(
      messageRepository.countBy({ ownerId: 'visitor-old' }),
    ).resolves.toBe(0);
    await expect(
      emotionRepository.countBy({ ownerId: 'visitor-old' }),
    ).resolves.toBe(0);
    await expect(
      checkInRepository.countBy({ ownerId: 'visitor-old' }),
    ).resolves.toBe(0);
    await expect(
      resourceRepository.countBy({ ownerId: 'visitor-old' }),
    ).resolves.toBe(0);
    await expect(
      sessionRepository.countBy({ ownerId: 'visitor-fresh' }),
    ).resolves.toBe(1);
    await expect(
      sessionRepository.countBy({
        ownerType: OwnerType.Teacher,
        ownerId: '7',
      }),
    ).resolves.toBe(1);
  });

  it('migrates all visitor rows once and prevents rebinding', async () => {
    const visitor = {
      ownerType: OwnerType.Visitor,
      ownerId: 'visitor-migration-001',
    };
    const session = await sessionRepository.save(
      sessionRepository.create({
        ...visitor,
        title: '待迁移会话',
        lastActiveAt: new Date(),
      }),
    );
    await messageRepository.save([
      messageRepository.create({
        ...visitor,
        sessionId: session.id,
        role: 'user',
        content: '用户消息',
      }),
      messageRepository.create({
        ...visitor,
        sessionId: session.id,
        role: 'assistant',
        content: '助教消息',
      }),
    ]);
    await emotionRepository.save(
      emotionRepository.create({
        ...visitor,
        sessionId: session.id,
        emotion: 'happy',
        intensity: 8,
      }),
    );
    await checkInRepository.save(
      checkInRepository.create({ ...visitor, checkInAt: new Date() }),
    );
    await resourceRepository.save(
      resourceRepository.create({
        ...visitor,
        title: '游客资源',
        type: 'image',
        url: null,
      }),
    );

    await expect(migration.migrate(visitor.ownerId, 42)).resolves.toEqual({
      success: true,
      migratedCount: 6,
    });
    for (const repository of [
      sessionRepository,
      messageRepository,
      emotionRepository,
      checkInRepository,
      resourceRepository,
    ]) {
      await expect(
        repository.countBy({
          ownerType: OwnerType.Visitor,
          ownerId: visitor.ownerId,
        }),
      ).resolves.toBe(0);
    }
    await expect(
      sessionRepository.countBy({
        ownerType: OwnerType.Teacher,
        ownerId: '42',
      }),
    ).resolves.toBe(1);
    await expect(
      messageRepository.countBy({
        ownerType: OwnerType.Teacher,
        ownerId: '42',
      }),
    ).resolves.toBe(2);
    await expect(
      migrationRepository.findOneByOrFail({ visitorId: visitor.ownerId }),
    ).resolves.toMatchObject({ teacherId: '42' });

    const duplicate = {
      success: false as const,
      message: '该游客数据已经迁移过，不可重复绑定',
    };
    await expect(migration.migrate(visitor.ownerId, 42)).resolves.toEqual(
      duplicate,
    );
    await expect(migration.migrate(visitor.ownerId, 99)).resolves.toEqual(
      duplicate,
    );
  });

  it('returns a successful zero count for an unknown visitor', async () => {
    await expect(
      migration.migrate('visitor-does-not-exist', 42),
    ).resolves.toEqual({
      success: true,
      migratedCount: 0,
    });
    await expect(
      migrationRepository.countBy({ visitorId: 'visitor-does-not-exist' }),
    ).resolves.toBe(0);
  });

  it('allows only one teacher to win concurrent migration attempts', async () => {
    const visitorId = 'visitor-concurrent-migration';
    await sessionRepository.save(
      sessionRepository.create({
        ownerType: OwnerType.Visitor,
        ownerId: visitorId,
        title: '并发迁移',
        lastActiveAt: new Date(),
      }),
    );

    const results = await Promise.all([
      migration.migrate(visitorId, 42),
      migration.migrate(visitorId, 99),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { success: true, migratedCount: 1 },
        {
          success: false,
          message: '该游客数据已经迁移过，不可重复绑定',
        },
      ]),
    );

    const record = await migrationRepository.findOneByOrFail({ visitorId });
    const session = await sessionRepository.findOneByOrFail({
      ownerType: OwnerType.Teacher,
      ownerId: record.teacherId,
    });
    expect(['42', '99']).toContain(session.ownerId);
  });
});
