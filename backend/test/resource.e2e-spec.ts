import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync } from 'node:fs';
import { readdir, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { Teacher } from '../src/auth/entities/teacher.entity';
import { TeachingResource } from '../src/data/entities/teaching-resource.entity';
import { RESOURCE_UPLOAD_DIRECTORY } from '../src/resources/resource-file.validation';
import { ResourceModule } from '../src/resources/resource.module';

type UploadedResource = {
  id: number;
  fileUrl: string;
  title: string;
  duration?: number | null;
  resourceType?: string;
  mimeType?: string;
};

describe('Resources (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  const uploaded: UploadedResource[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: 'resource-test-secret-with-enough-characters',
              JWT_EXPIRES_IN: '2h',
              TEST_TEACHER_ACCOUNT: 'resource_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '资源老师',
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Teacher, TeachingResource],
          synchronize: true,
        }),
        AuthModule,
        ResourceModule,
      ],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useStaticAssets(resolve(process.cwd(), 'uploads'), {
      prefix: '/uploads/',
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'resource_teacher', password: 'Teacher123!' })
      .expect(200);
    token = login.body.access_token as string;
  });

  afterAll(async () => {
    for (const resource of uploaded) {
      const path = join(RESOURCE_UPLOAD_DIRECTORY, basename(resource.fileUrl));
      if (existsSync(path)) await unlink(path);
    }
    await app.close();
  });

  async function upload(
    filename: string,
    body: Record<string, string>,
    content = Buffer.from('test-file'),
  ): Promise<UploadedResource> {
    let uploadRequest = request(app.getHttpServer())
      .post('/resources/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('title', body.title)
      .field('aliases', body.aliases ?? '[]')
      .field('description', body.description ?? '')
      .field('category', body.category ?? '图片卡片')
      .field('ageGroup', body.ageGroup ?? 'all')
      .field('tags', body.tags ?? '[]');
    if (body.duration)
      uploadRequest = uploadRequest.field('duration', body.duration);
    const response = await uploadRequest
      .attach('file', content, filename)
      .expect(201);
    const resource = response.body as UploadedResource;
    uploaded.push(resource);
    return resource;
  }

  it('requires a teacher token for upload', () =>
    request(app.getHttpServer())
      .post('/resources/upload')
      .field('title', '游客素材')
      .field('category', '图片卡片')
      .field('ageGroup', 'all')
      .attach('file', Buffer.from('jpg'), 'visitor.jpg')
      .expect(401));

  it('uploads JPG, MP3 and MP4 with UUID server names', async () => {
    const image = await upload('课堂照片.jpg', { title: '课堂照片' });
    const audio = await upload('律动音乐.mp3', {
      title: '律动音乐',
      category: '歌曲音乐',
      duration: '12.4',
    });
    const video = await upload('示范视频.mp4', {
      title: '示范视频',
      category: '视频动画',
    });
    expect(image.fileUrl).toMatch(/^\/uploads\/resources\/[0-9a-f-]{36}\.jpg$/);
    expect(audio.fileUrl).toMatch(/\.mp3$/);
    expect(audio.duration).toBe(12.4);
    expect(video.fileUrl).toMatch(/\.mp4$/);
    expect(
      existsSync(join(RESOURCE_UPLOAD_DIRECTORY, basename(image.fileUrl))),
    ).toBe(true);
    await request(app.getHttpServer()).get(image.fileUrl).expect(200);
  });

  it('uploads PPT and PPTX as document resources', async () => {
    const ppt = await upload('数字课堂.ppt', {
      title: '数字课堂',
      category: '教案课件',
    });
    const pptx = await upload('春天主题.pptx', {
      title: '春天主题',
      category: '教案课件',
    });

    expect(ppt.resourceType).toBe('document');
    expect(ppt.mimeType).toBe('application/vnd.ms-powerpoint');
    expect(ppt.fileUrl).toMatch(/\.ppt$/);
    expect(pptx.resourceType).toBe('document');
    expect(pptx.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(pptx.fileUrl).toMatch(/\.pptx$/);
  });

  it('rejects unsupported and oversized files with 400', async () => {
    await request(app.getHttpServer())
      .post('/resources/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('title', '文本')
      .field('category', '教案课件')
      .field('ageGroup', 'all')
      .attach('file', Buffer.from('text'), 'unsafe.txt')
      .expect(400);

    await request(app.getHttpServer())
      .post('/resources/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('title', '超大图片')
      .field('category', '图片卡片')
      .field('ageGroup', 'all')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'large.jpg')
      .expect(400);
  });

  it('removes the saved file when DTO validation fails', async () => {
    const before = await readdir(RESOURCE_UPLOAD_DIRECTORY);
    await request(app.getHttpServer())
      .post('/resources/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('title', '')
      .field('category', '图片卡片')
      .field('ageGroup', 'not-an-age')
      .attach('file', Buffer.from('jpg'), 'invalid-metadata.jpg')
      .expect(400);
    const after = await readdir(RESOURCE_UPLOAD_DIRECTORY);
    expect(after.sort()).toEqual(before.sort());
  });

  it('paginates, filters and ranks title before alias before tag', async () => {
    await upload('title.png', {
      title: '苹果',
      category: '图片卡片',
    });
    await upload('alias.png', {
      title: '水果卡片',
      aliases: '["苹果"]',
      category: '图片卡片',
    });
    await upload('tag.pdf', {
      title: '主题教案',
      tags: '["苹果"]',
      category: '教案课件',
    });

    const list = await request(app.getHttpServer())
      .get('/resources')
      .set('Authorization', `Bearer ${token}`)
      .query({
        resourceType: 'image',
        category: '图片卡片',
        page: 1,
        pageSize: 2,
      })
      .expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.total).toBeGreaterThanOrEqual(3);

    const search = await request(app.getHttpServer())
      .get('/resources/search')
      .set('Authorization', `Bearer ${token}`)
      .query({ keyword: '苹果' })
      .expect(200);
    expect(
      search.body.slice(0, 3).map((item: UploadedResource) => item.title),
    ).toEqual(['苹果', '水果卡片', '主题教案']);
    expect(search.body[0].score).toBeGreaterThan(search.body[1].score);
    expect(search.body[1].score).toBeGreaterThan(search.body[2].score);
  });

  it('updates metadata and deletes both the record and physical file', async () => {
    const resource = await upload('delete-me.pdf', {
      title: '待修改教案',
      category: '教案课件',
    });
    const filePath = join(
      RESOURCE_UPLOAD_DIRECTORY,
      basename(resource.fileUrl),
    );
    await request(app.getHttpServer())
      .patch(`/resources/${resource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '已修改教案', aliases: ['课堂教案'], tags: ['语言'] })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe('已修改教案');
        expect(body.aliases).toEqual(['课堂教案']);
      });
    await request(app.getHttpServer())
      .delete(`/resources/${resource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(existsSync(filePath)).toBe(false);
    await request(app.getHttpServer())
      .get(`/resources/${resource.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
