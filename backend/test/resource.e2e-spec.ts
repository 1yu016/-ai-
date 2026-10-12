import { BadGatewayException, ValidationPipe } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import {
  ResourceReviewStatus,
  TeachingResource,
} from '../src/data/entities/teaching-resource.entity';
import { PLATFORM_ENTITIES } from '../src/platform/platform.module';
import { LessonPlan } from '../src/lesson-plans/entities/lesson-plan.entity';
import { LessonStep } from '../src/lesson-plans/entities/lesson-step.entity';
import { ResourceVersion } from '../src/resources/entities/resource-version.entity';
import {
  UploadChunk,
  UploadSession,
  UploadSessionStatus,
} from '../src/resources/entities/upload-session.entity';
import {
  RESOURCE_CHUNK_DIRECTORY,
  RESOURCE_PREVIEW_DIRECTORY,
  RESOURCE_UPLOAD_DIRECTORY,
} from '../src/resources/resource-file.validation';
import { ResourceAiService } from '../src/resources/resource-ai.service';
import {
  RESOURCE_ENTITIES,
  ResourceModule,
} from '../src/resources/resource.module';
import { ResourceService } from '../src/resources/resource.service';

type UploadedResource = {
  id: number;
  fileUrl: string;
  title: string;
  resourceType: string;
  reviewStatus: string;
  sha256: string;
  ownerId: string;
};
const SHA = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const FILES: Record<string, Buffer> = {
  jpg: Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  mp3: Buffer.from('ID3\u0004\u0000\u0000sample-audio'),
  wav: Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([20, 0, 0, 0]),
    Buffer.from('WAVEfmt '),
    Buffer.alloc(16),
  ]),
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
  let resourceService: ResourceService;
  let resources: Repository<TeachingResource>;
  let versions: Repository<ResourceVersion>;
  let uploadSessions: Repository<UploadSession>;
  let uploadChunks: Repository<UploadChunk>;
  let initialFiles: Set<string>;
  let initialPreviewDirectories: Set<string>;

  beforeAll(async () => {
    initialFiles = new Set(await readdir(RESOURCE_UPLOAD_DIRECTORY));
    initialPreviewDirectories = new Set(
      await readdir(RESOURCE_PREVIEW_DIRECTORY),
    );
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
            LessonPlan,
            LessonStep,
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
    resourceService = app.get(ResourceService);
    resources = app.get(getRepositoryToken(TeachingResource));
    versions = app.get(getRepositoryToken(ResourceVersion));
    uploadSessions = app.get(getRepositoryToken(UploadSession));
    uploadChunks = app.get(getRepositoryToken(UploadChunk));
  });

  afterAll(async () => {
    for (const name of await readdir(RESOURCE_UPLOAD_DIRECTORY))
      if (!initialFiles.has(name))
        await unlink(join(RESOURCE_UPLOAD_DIRECTORY, name)).catch(
          () => undefined,
        );
    for (const name of await readdir(RESOURCE_PREVIEW_DIRECTORY))
      if (!initialPreviewDirectories.has(name))
        await rm(join(RESOURCE_PREVIEW_DIRECTORY, name), {
          recursive: true,
          force: true,
        });
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
    for (const filename of ['payload.exe', 'payload.js', 'payload.html']) {
      await request(app.getHttpServer())
        .post('/resources/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('title', '禁止格式')
        .field('category', 'x')
        .field('ageGroup', 'all')
        .attach('file', Buffer.from('not allowed'), filename)
        .expect(400);
    }
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
    const nurseryRhyme = await upload('nursery-rhyme.mp3', {
      resourceType: 'nursery_rhyme',
      category: '歌曲音乐',
    });
    const wav = await upload('recording.wav', {
      resourceType: 'audio',
      category: '课堂录音',
    });
    const video = await upload('movie.mp4', { resourceType: 'video' });
    const pdf = await upload('book.pdf', { resourceType: 'picture_book' });
    const legacyPpt = await upload('lesson.ppt', { resourceType: 'ppt' });
    const ppt = await upload('lesson.pptx', { resourceType: 'ppt' });
    expect([
      image.resourceType,
      audio.resourceType,
      nurseryRhyme.resourceType,
      wav.resourceType,
      video.resourceType,
      pdf.resourceType,
      legacyPpt.resourceType,
      ppt.resourceType,
    ]).toEqual([
      'image',
      'audio',
      'nursery_rhyme',
      'audio',
      'video',
      'picture_book',
      'ppt',
      'ppt',
    ]);
    expect(image.sha256).toBe(SHA(FILES.jpg));
    await request(app.getHttpServer())
      .get(`/resources/${image.id}/download`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/resources/${image.id}/download`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/resources/${image.id}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/resources/%2e%2e%2f.env/download')
      .set('Authorization', `Bearer ${token}`)
      .expect(({ status }) => expect([400, 404]).toContain(status));
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
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({ resourceId: title.id, isFavorite: true }),
      );
    await request(app.getHttpServer())
      .post(`/resources/${title.id}/favorite`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => expect(body.isFavorite).toBe(true));
    const list = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${token}`)
      .query({ keyword: '苹果', domain: '科学', page: 1, pageSize: 10 })
      .expect(200);
    expect(list.body.items[0].isFavorite).toBe(true);
    const favoriteList = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${token}`)
      .query({
        isFavorite: true,
        ownerId: title.ownerId,
        domain: '科学',
        tag: '水果',
      })
      .expect(200);
    expect(favoriteList.body.items.map((item: { id: number }) => item.id)).toContain(
      title.id,
    );
    const notFavoriteList = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${token}`)
      .query({ isFavorite: false, ownerId: title.ownerId })
      .expect(200);
    expect(
      notFavoriteList.body.items.map((item: { id: number }) => item.id),
    ).not.toContain(title.id);
    const search = await request(app.getHttpServer())
      .get('/resources/search')
      .set('Authorization', `Bearer ${token}`)
      .query({ keyword: '苹果' })
      .expect(200);
    expect(search.body[0].title).toBe('苹果');
    await request(app.getHttpServer())
      .patch(`/resources/${title.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '红苹果',
        description: '',
        category: '图片卡片',
        ageGroup: 'middle',
        domain: '语言',
        aliases: ['苹果卡片'],
        tags: ['水果', '红色'],
      })
      .expect(200);
    const edited = await request(app.getHttpServer())
      .get(`/resources/${title.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(edited.body).toMatchObject({
      title: '红苹果',
      description: null,
      category: '图片卡片',
      ageGroup: 'middle',
      domain: '语言',
      aliases: ['苹果卡片'],
      tags: ['水果', '红色'],
      fileName: 'apple.png',
    });
    await request(app.getHttpServer())
      .patch(`/resources/${title.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: '越权' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/resources/${title.id}/favorite`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({ resourceId: title.id, isFavorite: false }),
      );
    const afterUnfavorite = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${token}`)
      .query({ isFavorite: true })
      .expect(200);
    expect(
      afterUnfavorite.body.items.map((item: { id: number }) => item.id),
    ).not.toContain(title.id);
    await resources.update(title.id, {
      reviewStatus: ResourceReviewStatus.Disabled,
    });
    await request(app.getHttpServer())
      .patch(`/resources/${title.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '停用后修改' })
      .expect(409)
      .expect(({ body }) =>
        expect(body.message).toContain('已停用资源不可编辑'),
      );
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
      .expect(({ body }) => expect(body.reviewStatus).toBe('pending_review'));
    await request(app.getHttpServer())
      .get('/resources')
      .query({ reviewStatus: 'pending_review' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map((item: { id: number }) => item.id)).toContain(
          resource.id,
        ),
      );
    await request(app.getHttpServer())
      .get('/resources')
      .query({ reviewStatus: 'pending' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.map((item: { id: number }) => item.id)).toContain(
          resource.id,
        ),
      );
    await request(app.getHttpServer())
      .get(`/resources/${resource.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/resources/${resource.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'approved', comment: '通过' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/resources/${resource.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);

    const rejected = await upload('rejected.pdf', {
      title: '需要修改的资源',
      resourceType: 'pdf',
    });
    await request(app.getHttpServer())
      .post(`/resources/${rejected.id}/submit-review`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/resources/${rejected.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejected' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/resources/${rejected.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'rejected', comment: '请补充适用年龄说明' })
      .expect(201)
      .expect(({ body }) => expect(body.reviewStatus).toBe('rejected'));
    await request(app.getHttpServer())
      .post(`/resources/${rejected.id}/submit-review`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect(({ body }) => expect(body.reviewStatus).toBe('pending_review'));
    await request(app.getHttpServer())
      .post(`/resources/${resource.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', FILES.pdf, 'review-v2.pdf')
      .expect(201)
      .expect(({ body }) => {
        expect(body.reviewStatus).toBe('draft');
        expect(body.currentVersionId).not.toBe(resource.currentVersionId);
      });
    const storedVersions = await versions.find({
      where: { resourceId: resource.id },
      order: { versionNo: 'ASC' },
    });
    expect(storedVersions.map((version) => version.versionNo)).toEqual([1, 2]);
    const updatedResource = await resources.findOneByOrFail({
      id: resource.id,
    });
    expect(updatedResource.currentVersionId).toBe(storedVersions[1].id);
  });

  it('protects referenced resources and deletes unreferenced physical files safely', async () => {
    const protectedResource = await upload('protected.pdf', {
      resourceType: 'pdf',
    });
    await request(app.getHttpServer())
      .post(`/resources/${protectedResource.id}/references`)
      .set('Authorization', `Bearer ${token}`)
      .send({ referenceType: 'lesson_plan', referenceId: 'plan-1' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/resources/${protectedResource.id}/references`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
          referenceType: 'lesson_plan',
          referenceId: 'plan-1',
        });
      });
    await request(app.getHttpServer())
      .delete(`/resources/${protectedResource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409)
      .expect(({ body }) => expect(body.referenceCount).toBe(1));
    await request(app.getHttpServer())
      .delete(`/resources/${protectedResource.id}/references`)
      .set('Authorization', `Bearer ${token}`)
      .send({ referenceType: 'lesson_plan', referenceId: 'plan-1' })
      .expect(204);
    const storedVersion = await versions.findOneByOrFail({
      resourceId: protectedResource.id,
    });
    const storedPath = join(
      RESOURCE_UPLOAD_DIRECTORY,
      storedVersion.storagePath,
    );
    await expect(access(storedPath)).resolves.toBeUndefined();
    await request(app.getHttpServer())
      .delete(`/resources/${protectedResource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/resources/${protectedResource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await expect(access(storedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const deleted = await resources.findOneByOrFail({
      id: protectedResource.id,
    });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(deleted.reviewStatus).toBe('disabled');
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
          aliases: ['数字课件'],
          description: '支持断点续传的真实资源',
          category: '教案课件',
          ageGroup: 'all',
          domain: '科学',
          tags: ['分片', '测试'],
          duration: 12,
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
    const completed = await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '分片 PDF 正式标题',
        aliases: ['数字课件', '正式资源'],
        description: '上传完成后由教师确认的元数据',
        category: '正式课件',
        ageGroup: 'large',
        domain: '数学',
        tags: ['完成', '测试'],
        duration: 18,
      })
      .expect(201)
      .expect(({ body }) => expect(body.sha256).toBe(SHA(payload)));
    expect(completed.body).toMatchObject({
      title: '分片 PDF 正式标题',
      aliases: ['数字课件', '正式资源'],
      description: '上传完成后由教师确认的元数据',
      category: '正式课件',
      ageGroup: 'large',
      domain: '数学',
      tags: ['完成', '测试'],
      duration: 18,
      reviewStatus: 'draft',
    });
  });

  it('cancels an active upload session and removes uploaded chunks', async () => {
    const resourceCountBefore = await resources.count();
    const payload = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(64 * 1024 - 9, 6),
    ]);
    const session = (
      await request(app.getHttpServer())
        .post('/resources/upload-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: '待取消上传',
          resourceType: 'pdf',
          category: '课件',
          ageGroup: 'all',
          originalName: 'cancelled.pdf',
          declaredMime: 'application/pdf',
          totalSize: payload.length,
          chunkSize: 64 * 1024,
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/chunks/0`)
      .set('Authorization', `Bearer ${token}`)
      .field('sha256', SHA(payload))
      .attach('file', payload, 'chunk.part')
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/resources/upload-sessions/${session.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    const stored = await uploadSessions.findOneByOrFail({ id: session.id });
    expect(stored.status).toBe(UploadSessionStatus.Aborted);
    await expect(resources.count()).resolves.toBe(resourceCountBefore);
    await expect(
      uploadChunks.count({ where: { sessionId: session.id } }),
    ).resolves.toBe(0);
    await expect(
      access(join(RESOURCE_CHUNK_DIRECTORY, session.id)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
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
    await expect(
      access(join(RESOURCE_UPLOAD_DIRECTORY, `${session.id}.pdf`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      access(join(RESOURCE_CHUNK_DIRECTORY, session.id)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans expired resumable upload sessions and their physical chunks', async () => {
    const payload = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(64 * 1024 - 9, 5),
    ]);
    const session = (
      await request(app.getHttpServer())
        .post('/resources/upload-sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: '过期分片',
          resourceType: 'pdf',
          category: '课件',
          ageGroup: 'all',
          originalName: 'expired.pdf',
          declaredMime: 'application/pdf',
          totalSize: payload.length,
          chunkSize: 64 * 1024,
          expectedSha256: SHA(payload),
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/resources/upload-sessions/${session.id}/chunks/0`)
      .set('Authorization', `Bearer ${token}`)
      .field('sha256', SHA(payload))
      .attach('file', payload, 'chunk.part')
      .expect(201);
    await expect(
      access(join(RESOURCE_CHUNK_DIRECTORY, session.id, '0.part')),
    ).resolves.toBeUndefined();
    await uploadSessions.update(session.id, {
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(resourceService.cleanupExpiredUploads()).resolves.toBe(1);
    const expired = await uploadSessions.findOneByOrFail({ id: session.id });
    expect(expired.status).toBe(UploadSessionStatus.Expired);
    await expect(
      uploadChunks.count({ where: { sessionId: session.id } }),
    ).resolves.toBe(0);
    await expect(
      access(join(RESOURCE_CHUNK_DIRECTORY, session.id)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
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
    const stored = await resources.findOneByOrFail({ id: resource.id });
    expect(stored.ageGroup).toBe('all');
    expect(stored.aiTeachingGoals).toBeNull();
    expect(stored.aiActivitySuggestions).toBeNull();
    spy.mockRestore();
  });

  it('serves protected PPT page previews without exposing the source file', async () => {
    const presentation = await upload('preview.pptx', {
      title: '服务端转换课件',
      resourceType: 'ppt',
      category: '教案课件',
    });
    const unavailable = await request(app.getHttpServer())
      .get(`/resources/${presentation.id}/preview-manifest`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(unavailable.body).toMatchObject({
      status: 'unavailable',
      mode: 'unsupported',
      assets: [],
    });
    await request(app.getHttpServer())
      .get(`/resources/${presentation.id}/preview-manifest`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    const directory = join(
      RESOURCE_PREVIEW_DIRECTORY,
      String(presentation.id),
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'page-10.png'), FILES.png);
    await writeFile(join(directory, 'page-2.png'), FILES.png);
    const ready = await request(app.getHttpServer())
      .get(`/resources/${presentation.id}/preview-manifest`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(ready.body).toEqual({
      status: 'ready',
      mode: 'images',
      assets: [
        { name: 'page-2.png', mimeType: 'image/png', pageNumber: 2 },
        { name: 'page-10.png', mimeType: 'image/png', pageNumber: 10 },
      ],
      message: null,
    });
    await request(app.getHttpServer())
      .get(`/resources/${presentation.id}/preview-assets/page-2.png`)
      .set('Authorization', `Bearer ${token}`)
      .expect('Content-Type', /image\/png/)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/resources/${presentation.id}/preview-assets/page-2.png`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });

  it('uses the protected source for a PDF picture book when no page conversion exists', async () => {
    const pictureBook = await upload('picture-book.pdf', {
      title: 'PDF 绘本',
      resourceType: 'picture_book',
      category: '故事绘本',
    });
    const response = await request(app.getHttpServer())
      .get(`/resources/${pictureBook.id}/preview-manifest`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual({
      status: 'ready',
      mode: 'source',
      assets: [],
      message: null,
    });
  });
});
