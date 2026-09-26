import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Teacher } from '../src/auth/entities/teacher.entity';
import { DataModule, DATA_ENTITIES } from '../src/data/data.module';
import {
  ChatMessage,
  ChatMessageRole,
} from '../src/data/entities/chat-message.entity';
import { ChatSession } from '../src/data/entities/chat-session.entity';
import { CheckIn } from '../src/data/entities/check-in.entity';
import { EmotionEvent } from '../src/data/entities/emotion-event.entity';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import { VisitorMigration } from '../src/data/entities/visitor-migration.entity';
import { OwnerType } from '../src/data/owner.types';

describe('Visitor migration (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let teacherId: number;
  let sessionRepository: Repository<ChatSession>;
  let messageRepository: Repository<ChatMessage>;
  let emotionRepository: Repository<EmotionEvent>;
  let checkInRepository: Repository<CheckIn>;
  let resourceRepository: Repository<TeachingResource>;
  let migrationRepository: Repository<VisitorMigration>;
  const visitorId = 'migration-e2e-visitor';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: 'migration-e2e-secret-with-enough-characters',
              JWT_EXPIRES_IN: '2h',
              TEST_TEACHER_ACCOUNT: 'migration_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '迁移测试老师',
              VISITOR_RETENTION_DAYS: '14',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Teacher, ...DATA_ENTITIES],
          synchronize: true,
        }),
        AuthModule,
        DataModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    sessionRepository = app.get(getRepositoryToken(ChatSession));
    messageRepository = app.get(getRepositoryToken(ChatMessage));
    emotionRepository = app.get(getRepositoryToken(EmotionEvent));
    checkInRepository = app.get(getRepositoryToken(CheckIn));
    resourceRepository = app.get(getRepositoryToken(TeachingResource));
    migrationRepository = app.get(getRepositoryToken(VisitorMigration));

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'migration_teacher', password: 'Teacher123!' })
      .expect(200);
    token = login.body.access_token;
    teacherId = login.body.teacherId;

    const owner = { ownerType: OwnerType.Visitor, ownerId: visitorId };
    const session = await sessionRepository.save(
      sessionRepository.create({
        ...owner,
        title: '端到端迁移测试',
        lastActiveAt: new Date(),
      }),
    );
    await messageRepository.save(
      messageRepository.create({
        ...owner,
        sessionId: session.id,
        role: ChatMessageRole.User,
        content: '待迁移消息',
      }),
    );
    await emotionRepository.save(
      emotionRepository.create({
        ...owner,
        sessionId: session.id,
        emotion: 'happy',
        intensity: 7,
      }),
    );
    await checkInRepository.save(
      checkInRepository.create({ ...owner, checkInAt: new Date() }),
    );
    await resourceRepository.save(
      resourceRepository.create({
        ...owner,
        title: '待迁移资源',
        type: 'image',
        url: null,
      }),
    );
    await checkInRepository.save(
      checkInRepository.create({
        ownerType: OwnerType.Teacher,
        ownerId: String(teacherId),
        checkInAt: new Date(),
      }),
    );
  });

  afterAll(async () => app.close());

  it('returns 401 without a bearer token', () =>
    request(app.getHttpServer())
      .post('/data/migrate-visitor')
      .send({ visitorId })
      .expect(401));

  it('migrates every visitor-owned row to the authenticated teacher', async () => {
    await request(app.getHttpServer())
      .post('/data/migrate-visitor')
      .set('Authorization', `Bearer ${token}`)
      .send({ visitorId })
      .expect(200)
      .expect({ success: true, migratedCount: 5 });

    const teacherOwner = {
      ownerType: OwnerType.Teacher,
      ownerId: String(teacherId),
    };
    await expect(sessionRepository.countBy(teacherOwner)).resolves.toBe(1);
    await expect(messageRepository.countBy(teacherOwner)).resolves.toBe(1);
    await expect(emotionRepository.countBy(teacherOwner)).resolves.toBe(1);
    await expect(checkInRepository.countBy(teacherOwner)).resolves.toBe(2);
    await expect(resourceRepository.countBy(teacherOwner)).resolves.toBe(1);
    await expect(
      migrationRepository.countBy({ visitorId, teacherId: String(teacherId) }),
    ).resolves.toBe(1);
  });

  it('rejects a second migration without changing data', async () => {
    await request(app.getHttpServer())
      .post('/data/migrate-visitor')
      .set('Authorization', `Bearer ${token}`)
      .send({ visitorId })
      .expect(200)
      .expect({
        success: false,
        message: '该游客数据已经迁移过，不可重复绑定',
      });

    await expect(
      checkInRepository.countBy({
        ownerType: OwnerType.Teacher,
        ownerId: String(teacherId),
      }),
    ).resolves.toBe(2);
  });

  it('returns success with a zero count for an unknown visitor', () =>
    request(app.getHttpServer())
      .post('/data/migrate-visitor')
      .set('Authorization', `Bearer ${token}`)
      .send({ visitorId: 'missing-visitor-id' })
      .expect(200)
      .expect({ success: true, migratedCount: 0 }));
});
