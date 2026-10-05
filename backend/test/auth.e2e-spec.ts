import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Teacher } from '../src/auth/entities/teacher.entity';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let teacherRepository: Repository<Teacher>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: 'test-secret-with-enough-random-characters',
              JWT_EXPIRES_IN: '2h',
              TEST_TEACHER_ACCOUNT: 'teacher_test',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '测试老师',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Teacher, Administrator, RefreshTokenSession],
          synchronize: true,
        }),
        AuthModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    teacherRepository = app.get<Repository<Teacher>>(
      getRepositoryToken(Teacher),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the test teacher with a bcrypt password hash', async () => {
    const teacher = await teacherRepository
      .createQueryBuilder('teacher')
      .addSelect('teacher.passwordHash')
      .where('teacher.account = :account', { account: 'teacher_test' })
      .getOneOrFail();

    expect(teacher.passwordHash).not.toBe('Teacher123!');
    await expect(
      bcrypt.compare('Teacher123!', teacher.passwordHash),
    ).resolves.toBe(true);
  });

  it('logs in and returns an access token and teacher id', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'teacher_test', password: 'Teacher123!' })
      .expect(200);

    expect(response.body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      expires_in: expect.any(Number),
      userType: 'teacher',
      teacherId: expect.any(Number),
    });
  });

  it('returns 401 without a token and allows a valid token', async () => {
    await request(app.getHttpServer()).get('/auth/profile').expect(401);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'teacher_test', password: 'Teacher123!' })
      .expect(200);

    const profile = await request(app.getHttpServer())
      .get('/auth/profile')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(200);

    expect(profile.body).toMatchObject({
      teacherId: login.body.teacherId,
      userId: login.body.teacherId,
      account: 'teacher_test',
      name: '测试老师',
      role: 'teacher',
      userType: 'teacher',
    });
  });

  it('rejects an incorrect password', () =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'teacher_test', password: 'wrong-password' })
      .expect(401));
});
