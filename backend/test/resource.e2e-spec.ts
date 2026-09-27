import { BadGatewayException, ValidationPipe } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import { PLATFORM_ENTITIES } from '../src/platform/platform.module';
import { RESOURCE_UPLOAD_DIRECTORY } from '../src/resources/resource-file.validation';
import { ResourceAiService } from '../src/resources/resource-ai.service';
import {
  RESOURCE_ENTITIES,
  ResourceModule,
} from '../src/resources/resource.module';

type UploadedResource = {
  id: number;
  fileUrl: string;
  title: string;
  resourceType: string;
  reviewStatus: string;
  sha256: string;
};
const SHA = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const FILES: Record<string, Buffer> = {
  jpg: Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  mp3: Buffer.from('ID3\u0004\u0000\u0000sample-audio'),
  mp4: Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypisom'),
    Buffer.alloc(20),
  ]),
  pdf: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF'),
  ppt: Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(20),
  ]),
  pptx: Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('[Content_Types].xml ppt/slides/slide1.xml'),
  ]),
};

describe('Stage two resource library (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  let otherToken: string;
  let adminToken: string;
  let ai: ResourceAiService;
  let initialFiles: Set<string>;

  beforeAll(async () => {
    initialFiles = new Set(await readdir(RESOURCE_UPLOAD_DIRECTORY));
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'resource-test-secret-with-enough-characters',
              JWT_ACCESS_EXPIRES_IN: '2h',
              JWT_REFRESH_EXPIRES_IN: '30d',
              TEST_TEACHER_ACCOUNT: 'resource_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '资源老师',
              ARK_API_KEY: 'test-key',
              ARK_ENDPOINT_ID: 'test-model',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [
            Teacher,
            Administrator,
            RefreshTokenSession,
            TeachingResource,
            ...RESOURCE_ENTITIES,
            ...PLATFORM_ENTITIES,
          ],
          synchronize: true,
        }),
        AuthModule,
        ResourceModule,
      ],
    }).compile();
    app = fixture.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const admins = app.get<Repository<Administrator>>(
      getRepositoryToken(Administrator),
    );
    const primaryTeacher = await teachers.findOneByOrFail({
      account: 'resource_teacher',
    });
    primaryTeacher.schoolId = 'garden-1';
    await teachers.save(primaryTeacher);
    await teachers.save(
      teachers.create({
        account: 'resource_other',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '其他教师',
        role: TeacherRole.Teacher,
        schoolId: 'garden-1',
      }),
    );
    await admins.save(
      admins.create({
        account: 'resource_admin',
        passwordHash: await bcrypt.hash('Admin123!', 4),
        name: '资源管理员',
        schoolId: 'garden-1',
      }),
    );
    token = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: 'resource_teacher', password: 'Teacher123!' })
        .expect(200)
    ).body.access_token;
    otherToken = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: 'resource_other', password: 'Teacher123!' })
        .expect(200)
    ).body.access_token;
    adminToken = (
      await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ account: 'resource_admin', password: 'Admin123!' })
        .expect(200)
    ).body.access_token;
    ai = app.get(ResourceAiService);
  });

  afterAll(async () => {
    for (const name of await readdir(RESOURCE_UPLOAD_DIRECTORY))
      if (!initialFiles.has(name))
        await unlink(join(RESOURCE_UPLOAD_DIRECTORY, name)).catch(
          () => undefined,
        );
    await app.close();
  });

  async function upload(
    filename: string,
    body: Record<string, string> = {},
    content?: Buffer,
    auth = token,
  ): Promise<UploadedResource> {
    const ext = filename.split('.').pop()!.toLowerCase();
    let call = request(app.getHttpServer())
      .post('/resources/upload')
      .set('Authorization', `Bearer ${auth}`)
      .field('title', body.title ?? filename)
      .field('category', body.category ?? '图片卡片')
      .field('ageGroup', body.ageGroup ?? 'all')
      .field('aliases', body.aliases ?? '[]')
      .field('tags', body.tags ?? '[]');
    if (body.resourceType) call = call.field('resourceType', body.resourceType);
    if (body.domain) call = call.field('domain', body.domain);
    return (
      await call.attach('file', content ?? FILES[ext], filename).expect(201)
    ).body as UploadedResource;
  }

  it('validates authentication, magic bytes, MIME, double extensions and size limits', async () => {
    await request(app.getHttpServer())
      .post('/resources/upload')
      .field('title', 'x')
      .field('category', 'x')
      .field('ageGroup', 'all')
      .attach('file', FILES.jpg, 'x.jpg')
      .expect(401);
    await request(app.getHttpServer())
      .post('/resources/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('title', '伪装')
      .field('category', 'x')
      .field('ageGroup', 'all')
      .attach('file', FILES.jpg, 'fake.png')
      .expect(400);
    await request(app.getHttpServer())
      .post('/resources/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('title', '双扩展')
      .field('category', 'x')
      .field('ageGroup', 'all')
      .attach('file', FILES.jpg, 'shell.exe.jpg')
      .expect(400);
    await request(app.getHttpServer())
      .post('/resources/upload-sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '路径穿越',
        resourceType: 'pdf',
        category: '课件',
        ageGroup: 'all',
        originalName: '../escape.pdf',
        declaredMime: 'application/pdf',
        totalSize: FILES.pdf.length,
        chunkSize: 64 * 1024,
      })
      .expect(400);
    const oversized = Buffer.concat([
      FILES.jpg,
      Buffer.alloc(15 * 1024 * 1024),
    ]);
    await request(app.getHttpServer())
      .post('/resources/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('title', '超限')
      .field('category', 'x')
      .field('ageGroup', 'all')
      .attach('file', oversized, 'large.jpg')
      .expect(400);
  });

  it('supports required resource types, hashes content and protects downloads', async () => {
    const image = await upload('image.jpg', { resourceType: 'image' });
    const audio = await upload('song.mp3', {
      resourceType: 'audio',
      category: '歌曲音乐',
    });
    const video = await upload('movie.mp4', { resourceType: 'video' });
    const pdf = await upload('book.pdf', { resourceType: 'picture_book' });
    const ppt = await upload('lesson.pptx', { resourceType: 'ppt' });
    expect([
      image.resourceType,
      audio.resourceType,
      video.resourceType,
      pdf.resourceType,
      ppt.resourceType,
    ]).toEqual(['image', 'audio', 'video', 'picture_book', 'ppt']);
    expect(image.sha256).toBe(SHA(FILES.jpg));
    await request(app.getHttpServer())
      .get(`/resources/${image.id}/download`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/resources/${image.id}/download`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/resources/${image.id}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('provides stable filtered search, favorites and safe metadata editing', async () => {
    const title = await upload('apple.png', {
      title: '苹果',
      tags: '["水果"]',
      domain: '科学',
    });
    await upload('alias.png', { title: '水果卡片', aliases: '["苹果"]' });
    await request(app.getHttpServer())
      .post(`/resources/${title.id}/favorite`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await request(app.getHttpServer())
      .post(`/resources/${title.id}/favorite`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    const list = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${token}`)
      .query({ keyword: '苹果', domain: '科学', page: 1, pageSize: 10 })
      .expect(200);
    expect(list.body.items[0].isFavorite).toBe(true);
    const search = await request(app.getHttpServer())
      .get('/resources/search')
      .set('Authorization', `Bearer ${token}`)
      .query({ keyword: '苹果' })
      .expect(200);
    expect(search.body[0].title).toBe('苹果');
    await request(app.getHttpServer())
      .patch(`/resources/${title.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: '越权' })
      .expect(404);
  });

  it('enforces submission and administrator review before sharing', async () => {
    const resource = await upload('review.pdf', {
      title: '待审核',
      resourceType: 'pdf',
    });
    expect(resource.reviewStatus).toBe('draft');
    await request(app.getHttpServer())
      .post(`/resources/${resource.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'approved' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/resources/${resource.id}/submit-review`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect(({ body }) => expect(body.reviewStatus).toBe('pending'));
    await request(app.getHttpServer())
      .get(`/resources/${resource.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/resources/${resource.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved', comment: '通过' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/resources/${resource.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/resources/${resource.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', FILES.pdf, 'review-v2.pdf')
      .expect(201)
      .expect(({ body }) => expect(body.reviewStatus).toBe('draft'));
  });

  it('protects referenced resources and deletes unreferenced physical files safely', async () => {
    const protectedResource = await upload('protected.pdf', {
      resourceType: 'pdf',
    });
    await request(app.getHttpServer())
      .post(`/resources/${protectedResource.id}/references`)
      .set('Authorization', `Bearer ${token}`)
      .send({ referenceType: 'classroom', referenceId: 'run-1' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/resources/${protectedResource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409)
      .expect(({ body }) => expect(body.referenceCount).toBe(1));
    await request(app.getHttpServer())
      .delete(`/resources/${protectedResource.id}/references`)
      .set('Authorization', `Bearer ${token}`)
      .send({ referenceType: 'classroom', referenceId: 'run-1' })
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/resources/${protectedResource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/resources/${protectedResource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('supports resumable chunks, idempotent duplicates, missing chunks and ownership isolation', async () => {
    const payload = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(100 * 1024, 7),
    ]);
    const chunkSize = 64 * 1024;
    const first = payload.subarray(0, chunkSize),
      second = payload.subarray(chunkSize);
    const session = (
      await request(app.getHttpServer())
        .post('/resources/upload-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: '分片PDF',
          resourceType: 'pdf',
          category: '教案课件',
          ageGroup: 'all',
          originalName: 'chunked.pdf',
          declaredMime: 'application/pdf',
          totalSize: payload.length,
          chunkSize,
          expectedSha256: SHA(payload),
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/chunks/0`)
      .set('Authorization', `Bearer ${otherToken}`)
      .field('sha256', SHA(first))
      .attach('file', first, 'chunk.part')
      .expect(403);
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/chunks/0`)
      .set('Authorization', `Bearer ${token}`)
      .field('sha256', '0'.repeat(64))
      .attach('file', first, 'chunk.part')
      .expect(400);
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/chunks/0`)
      .set('Authorization', `Bearer ${token}`)
      .field('sha256', SHA(first))
      .attach('file', first, 'chunk.part')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/chunks/0`)
      .set('Authorization', `Bearer ${token}`)
      .field('sha256', SHA(first))
      .attach('file', first, 'chunk.part')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    const resumed = await request(app.getHttpServer())
      .get(`/resources/upload-sessions/${session.id}/chunks`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resumed.body.uploadedChunks).toHaveLength(1);
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/chunks/1`)
      .set('Authorization', `Bearer ${token}`)
      .field('sha256', SHA(second))
      .attach('file', second, 'chunk.part')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect(({ body }) => expect(body.sha256).toBe(SHA(payload)));
  });

  it('cleans chunk files when merged content hash verification fails', async () => {
    const payload = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(70 * 1024, 3),
    ]);
    const chunkSize = 64 * 1024;
    const chunks = [
      payload.subarray(0, chunkSize),
      payload.subarray(chunkSize),
    ];
    const session = (
      await request(app.getHttpServer())
        .post('/resources/upload-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: '错误哈希',
          resourceType: 'pdf',
          category: '教案课件',
          ageGroup: 'all',
          originalName: 'bad-hash.pdf',
          declaredMime: 'application/pdf',
          totalSize: payload.length,
          chunkSize,
          expectedSha256: '0'.repeat(64),
        })
        .expect(201)
    ).body;
    for (let index = 0; index < chunks.length; index += 1) {
      await request(app.getHttpServer())
        .post(`/resources/upload-sessions/${session.id}/chunks/${index}`)
        .set('Authorization', `Bearer ${token}`)
        .field('sha256', SHA(chunks[index]))
        .attach('file', chunks[index], 'chunk.part')
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    const state = await request(app.getHttpServer())
      .get(`/resources/upload-sessions/${session.id}/chunks`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(state.body.status).toBe('failed');
    expect(state.body.uploadedChunks).toEqual([]);
  });

  it('does not persist malformed AI suggestions or affect the resource', async () => {
    const resource = await upload('ai.pdf', {
      title: 'AI标注',
      resourceType: 'pdf',
    });
    const spy = jest
      .spyOn(ai, 'suggest')
      .mockRejectedValueOnce(new BadGatewayException('AI 返回格式错误'));
    await request(app.getHttpServer())
      .post(`/resources/${resource.id}/ai-suggestion`)
      .set('Authorization', `Bearer ${token}`)
      .expect(502);
    const detail = await request(app.getHttpServer())
      .get(`/resources/${resource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.tags).toEqual([]);
    spy.mockRestore();
  });
});
