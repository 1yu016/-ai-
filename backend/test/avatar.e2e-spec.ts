import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { Administrator } from '../src/auth/entities/administrator.entity';
import { RefreshTokenSession } from '../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../src/auth/entities/teacher.entity';
import { AVATAR_ENTITIES, AvatarModule } from '../src/avatars/avatar.module';
import { AVATAR_UPLOAD_DIRECTORY } from '../src/avatars/avatar-file.validation';
import {
  AvatarAssetType,
  AvatarVersionStatus,
} from '../src/avatars/avatar.types';
import { AvatarAsset } from '../src/avatars/entities/avatar-asset.entity';
import { AvatarCharacter } from '../src/avatars/entities/avatar-character.entity';
import { AvatarVersion } from '../src/avatars/entities/avatar-version.entity';
import { CLASSROOM_RUN_ENTITIES } from '../src/classroom-runs/classroom-run.module';
import {
  ClassroomRunStatus,
  ClassroomSnapshotReason,
} from '../src/classroom-runs/classroom-run.types';
import { ClassroomRun } from '../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../src/classroom-runs/entities/classroom-snapshot.entity';
import {
  PLATFORM_ENTITIES,
  PlatformModule,
} from '../src/platform/platform.module';

const GLB_JSON = Buffer.from('{"asset":{"version":"2.0"}} ');
const GLB = (() => {
  const header = Buffer.alloc(20);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + GLB_JSON.length, 8);
  header.writeUInt32LE(GLB_JSON.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, GLB_JSON]);
})();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JSON_FILE = Buffer.from('{"visemes":[]}');

describe('Task six avatar character, version and asset management (e2e)', () => {
  let app: INestApplication;
  let teacherToken: string;
  let otherToken: string;
  let adminToken: string;
  let teacherId: number;
  let characterId: number;
  let versionId: number;
  let initialEntries: Set<string>;
  let characters: Repository<AvatarCharacter>;
  let versions: Repository<AvatarVersion>;
  let assets: Repository<AvatarAsset>;
  let runs: Repository<ClassroomRun>;
  let snapshots: Repository<ClassroomSnapshot>;

  const auth = (token = teacherToken) => ({
    Authorization: `Bearer ${token}`,
  });

  beforeAll(async () => {
    initialEntries = new Set(await readdir(AVATAR_UPLOAD_DIRECTORY));
    const fixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'avatar-test-secret-long-enough',
              JWT_ACCESS_EXPIRES_IN: '2h',
              JWT_REFRESH_EXPIRES_IN: '30d',
              TEST_TEACHER_ACCOUNT: 'avatar_teacher',
              TEST_TEACHER_PASSWORD: 'Teacher123!',
              TEST_TEACHER_NAME: '数字人教师',
              AVATAR_SUPPORTED_ENGINE_VERSIONS: 'avatar-engine-1',
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
            ...PLATFORM_ENTITIES,
            ...CLASSROOM_RUN_ENTITIES,
            ...AVATAR_ENTITIES,
          ],
          synchronize: true,
        }),
        AuthModule,
        PlatformModule,
        AvatarModule,
      ],
    }).compile();
    app = fixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const teachers = app.get<Repository<Teacher>>(getRepositoryToken(Teacher));
    const primary = await teachers.findOneByOrFail({
      account: 'avatar_teacher',
    });
    primary.schoolId = 'avatar-garden';
    await teachers.save(primary);
    teacherId = primary.id;
    await teachers.save(
      teachers.create({
        account: 'avatar_other',
        passwordHash: await bcrypt.hash('Teacher123!', 4),
        name: '其他数字人教师',
        role: TeacherRole.Teacher,
        schoolId: 'avatar-garden',
      }),
    );
    const admins = app.get<Repository<Administrator>>(
      getRepositoryToken(Administrator),
    );
    await admins.save(
      admins.create({
        account: 'avatar_admin',
        passwordHash: await bcrypt.hash('Admin123!', 4),
        name: '数字人管理员',
        schoolId: 'avatar-garden',
      }),
    );
    teacherToken = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: 'avatar_teacher', password: 'Teacher123!' })
        .expect(200)
    ).body.access_token as string;
    otherToken = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ account: 'avatar_other', password: 'Teacher123!' })
        .expect(200)
    ).body.access_token as string;
    adminToken = (
      await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ account: 'avatar_admin', password: 'Admin123!' })
        .expect(200)
    ).body.access_token as string;

    characters = app.get(getRepositoryToken(AvatarCharacter));
    versions = app.get(getRepositoryToken(AvatarVersion));
    assets = app.get(getRepositoryToken(AvatarAsset));
    runs = app.get(getRepositoryToken(ClassroomRun));
    snapshots = app.get(getRepositoryToken(ClassroomSnapshot));
  });

  afterAll(async () => {
    for (const entry of await readdir(AVATAR_UPLOAD_DIRECTORY))
      if (!initialEntries.has(entry))
        await rm(join(AVATAR_UPLOAD_DIRECTORY, entry), {
          recursive: true,
          force: true,
        });
    await app.close();
  });

  async function createVersion(engineVersion = 'avatar-engine-1') {
    return (
      await request(app.getHttpServer())
        .post(`/avatars/characters/${characterId}/versions`)
        .set(auth())
        .field('engineVersion', engineVersion)
        .field('modelFormat', 'glb')
        .field('compatibility', '{"minimumRuntime":"1.0"}')
        .attach('file', GLB, 'character.glb')
        .expect(201)
    ).body as { id: number; version: number; assets: Array<{ id: number }> };
  }

  async function uploadAsset(
    targetVersionId: number,
    assetType: string,
    filename: string,
    content: Buffer,
    actionName?: string,
    metadata?: string,
  ) {
    let call = request(app.getHttpServer())
      .post(`/avatars/versions/${targetVersionId}/assets`)
      .set(auth())
      .field('assetType', assetType);
    if (actionName) call = call.field('actionName', actionName);
    if (metadata) call = call.field('metadata', metadata);
    return (await call.attach('file', content, filename).expect(201)).body as {
      id: number;
      assetType: string;
      actionName: string | null;
      contentUrl: string;
    };
  }

  async function completeVersion(targetVersionId: number) {
    await uploadAsset(targetVersionId, 'texture', 'body.png', PNG);
    await uploadAsset(targetVersionId, 'animation', 'idle.glb', GLB, 'idle');
    await uploadAsset(targetVersionId, 'animation', 'speak.glb', GLB, 'speak');
    await uploadAsset(targetVersionId, 'lip_sync', 'lip.json', JSON_FILE);
    await uploadAsset(targetVersionId, 'preview', 'preview.png', PNG);
    await uploadAsset(targetVersionId, 'fallback_2d', 'fallback.png', PNG);
  }

  it('requires login, creates a private character and enforces owner permissions', async () => {
    await request(app.getHttpServer())
      .post('/avatars/characters')
      .send({ name: '未登录角色', category: 'cartoon_animal' })
      .expect(401);
    const created = await request(app.getHttpServer())
      .post('/avatars/characters')
      .set(auth())
      .send({
        name: '小鹿老师',
        category: 'teacher_assistant',
        description: '课堂数字人',
      })
      .expect(201);
    characterId = created.body.id as number;
    expect(created.body).toMatchObject({
      status: 'draft',
      ownerId: teacherId,
      currentVersionId: null,
    });
    await request(app.getHttpServer())
      .patch(`/avatars/characters/${characterId}`)
      .set(auth(otherToken))
      .send({ name: '越权修改' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/avatars/characters/${characterId}`)
      .set(auth(adminToken))
      .send({ description: '管理员检查通过的数据范围' })
      .expect(200);
  });

  it('rejects disguised files, double extensions and unsafe configuration without residue', async () => {
    await request(app.getHttpServer())
      .post(`/avatars/characters/${characterId}/versions`)
      .set(auth())
      .field('engineVersion', 'avatar-engine-1')
      .field('modelFormat', 'glb')
      .attach('file', PNG, 'fake.glb')
      .expect(400);
    await request(app.getHttpServer())
      .post(`/avatars/characters/${characterId}/versions`)
      .set(auth())
      .field('engineVersion', 'avatar-engine-1')
      .field('modelFormat', 'glb')
      .attach('file', GLB, 'avatar.exe.glb')
      .expect(400);
    const before = new Set(await readdir(AVATAR_UPLOAD_DIRECTORY));
    await request(app.getHttpServer())
      .post(`/avatars/characters/${characterId}/versions`)
      .set(auth())
      .field('engineVersion', 'avatar-engine-1')
      .field('modelFormat', 'glb')
      .field('compatibility', '{"loader":"https://evil.example/x.js"}')
      .attach('file', GLB, 'unsafe.glb')
      .expect(400);
    expect(new Set(await readdir(AVATAR_UPLOAD_DIRECTORY))).toEqual(before);
  });

  it('creates a model version, rejects unsafe actions and blocks incomplete publication', async () => {
    const version = await createVersion();
    versionId = version.id;
    expect(version).toMatchObject({ version: 1 });
    expect(JSON.stringify(version)).not.toContain('filePath');

    await request(app.getHttpServer())
      .post(`/avatars/versions/${versionId}/assets`)
      .set(auth())
      .field('assetType', 'animation')
      .field('actionName', 'dance')
      .attach('file', GLB, 'dance.glb')
      .expect(400);
    await request(app.getHttpServer())
      .post(`/avatars/versions/${versionId}/assets`)
      .set(auth())
      .field('assetType', 'animation')
      .field('actionName', 'idle')
      .field('metadata', '{"handler":"javascript:alert(1)"}')
      .attach('file', GLB, 'unsafe-action.glb')
      .expect(400);
    const integrity = await request(app.getHttpServer())
      .get(`/avatars/versions/${versionId}/integrity`)
      .set(auth())
      .expect(200);
    expect(integrity.body.valid).toBe(false);
    expect(
      integrity.body.issues.map((item: { code: string }) => item.code),
    ).toEqual(
      expect.arrayContaining(['TEXTURE_REQUIRED', 'LIP_SYNC_REQUIRED']),
    );
    await request(app.getHttpServer())
      .post(`/avatars/versions/${versionId}/publish`)
      .set(auth())
      .expect(409);
  });

  it('uploads all required asset types, publishes and shares only after admin review', async () => {
    await completeVersion(versionId);
    const integrity = await request(app.getHttpServer())
      .get(`/avatars/versions/${versionId}/integrity`)
      .set(auth())
      .expect(200);
    expect(integrity.body).toMatchObject({ valid: true, issues: [] });
    expect(integrity.body.calculatedChecksum).toMatch(/^[a-f0-9]{64}$/);
    const published = await request(app.getHttpServer())
      .post(`/avatars/versions/${versionId}/publish`)
      .set(auth())
      .expect(201);
    expect(published.body.status).toBe('ready');

    await request(app.getHttpServer())
      .post(`/avatars/characters/${characterId}/submit-review`)
      .set(auth())
      .expect(201);
    await request(app.getHttpServer())
      .post(`/avatars/characters/${characterId}/review`)
      .set(auth(adminToken))
      .send({ status: 'approved', comment: '资源完整' })
      .expect(201);
    const shared = await request(app.getHttpServer())
      .get(`/avatars/characters/${characterId}`)
      .set(auth(otherToken))
      .expect(200);
    expect(shared.body.status).toBe('approved');
    expect(JSON.stringify(shared.body)).not.toContain('filePath');
    expect(JSON.stringify(shared.body)).not.toContain(AVATAR_UPLOAD_DIRECTORY);
    const preview = shared.body.versions[0].assets.find(
      (item: { assetType: string }) => item.assetType === 'preview',
    ) as { id: number };
    await request(app.getHttpServer())
      .get(`/avatars/assets/${preview.id}/content`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/avatars/assets/${preview.id}/content`)
      .set(auth(otherToken))
      .expect(200)
      .expect('Content-Type', /image\/png/);
  });

  it('creates a new model version without overwriting history and reports engine incompatibility', async () => {
    const second = await createVersion('legacy-engine');
    expect(second.version).toBe(2);
    expect(await versions.count({ where: { characterId } })).toBe(2);
    expect(await versions.findOneByOrFail({ id: versionId })).toMatchObject({
      status: AvatarVersionStatus.Ready,
    });
    await completeVersion(second.id);
    const integrity = await request(app.getHttpServer())
      .get(`/avatars/versions/${second.id}/integrity`)
      .set(auth())
      .expect(200);
    expect(
      integrity.body.issues.map((item: { code: string }) => item.code),
    ).toContain('ENGINE_VERSION_INCOMPATIBLE');
    const incompatible = await request(app.getHttpServer())
      .post(`/avatars/versions/${second.id}/publish`)
      .set(auth())
      .expect(409);
    expect(
      incompatible.body.issues.map((item: { code: string }) => item.code),
    ).toContain('ENGINE_VERSION_INCOMPATIBLE');
    await request(app.getHttpServer())
      .patch(`/avatars/versions/${second.id}/status`)
      .set(auth(adminToken))
      .send({ status: 'disabled', reason: '旧引擎不兼容' })
      .expect(200);
  });

  it('detects checksum corruption before publication', async () => {
    const model = await assets.findOneByOrFail({
      versionId,
      assetType: AvatarAssetType.Model,
    });
    const originalChecksum = model.checksum;
    model.checksum = '0'.repeat(64);
    await assets.save(model);
    const integrity = await request(app.getHttpServer())
      .get(`/avatars/versions/${versionId}/integrity`)
      .set(auth())
      .expect(200);
    expect(
      integrity.body.issues.map((item: { code: string }) => item.code),
    ).toContain('ASSET_CHECKSUM_MISMATCH');
    await request(app.getHttpServer())
      .post(`/avatars/versions/${versionId}/publish`)
      .set(auth())
      .expect(409);
    model.checksum = originalChecksum;
    await assets.save(model);
  });

  it('pins the selected version in classroom state and prevents referenced deletion', async () => {
    const character = await characters.findOneByOrFail({ id: characterId });
    character.currentVersionId = null;
    await characters.save(character);
    const now = new Date();
    const run = await runs.save(
      runs.create({
        lessonPlanId: 1,
        lessonPlanVersion: 1,
        teacherId,
        classId: 100,
        classroomId: 100,
        deviceId: 100,
        avatarVersionId: versionId,
        title: '数字人版本固定课堂',
        status: ClassroomRunStatus.Running,
        currentStepIndex: 0,
        startedAt: now,
        pausedAt: null,
        resumedAt: now,
        endedAt: null,
        elapsedSeconds: 0,
        version: 1,
      }),
    );
    const snapshot = await snapshots.save(
      snapshots.create({
        classroomRunId: run.id,
        snapshotVersion: 1,
        runVersion: 1,
        runStatus: ClassroomRunStatus.Running,
        currentStepIndex: 0,
        elapsedSeconds: 0,
        playedResourceIds: '[]',
        attendanceState: '{}',
        rollCallState: '{}',
        rewardState: '{}',
        interactionState: '{}',
        playerState: '{}',
        deviceId: 100,
        avatarVersionId: versionId,
        reason: ClassroomSnapshotReason.Start,
        isKey: true,
        checksum: 'test-snapshot-checksum',
      }),
    );
    expect(run.avatarVersionId).toBe(versionId);
    expect(snapshot.avatarVersionId).toBe(versionId);
    const blocked = await request(app.getHttpServer())
      .delete(`/avatars/versions/${versionId}`)
      .set(auth())
      .expect(409);
    expect(blocked.body.message).toContain('课堂快照');
    await snapshots.delete({ id: snapshot.id });
    await runs.delete({ id: run.id });
  });

  it('keeps database records when physical deletion cannot start', async () => {
    const draft = await createVersion();
    const model = await assets.findOneByOrFail({
      versionId: draft.id,
      assetType: AvatarAssetType.Model,
    });
    await unlink(join(AVATAR_UPLOAD_DIRECTORY, model.filePath));
    await request(app.getHttpServer())
      .delete(`/avatars/versions/${draft.id}`)
      .set(auth())
      .expect(500);
    expect(await versions.exists({ where: { id: draft.id } })).toBe(true);
    expect(await assets.exists({ where: { id: model.id } })).toBe(true);
  });

  it('deletes an unreferenced version and its physical files together', async () => {
    const draft = await createVersion();
    const model = await assets.findOneByOrFail({
      versionId: draft.id,
      assetType: AvatarAssetType.Model,
    });
    const physicalPath = join(AVATAR_UPLOAD_DIRECTORY, model.filePath);
    await expect(stat(physicalPath)).resolves.toBeDefined();
    await request(app.getHttpServer())
      .delete(`/avatars/versions/${draft.id}`)
      .set(auth())
      .expect(200);
    expect(await versions.exists({ where: { id: draft.id } })).toBe(false);
    expect(await assets.exists({ where: { versionId: draft.id } })).toBe(false);
    await expect(stat(physicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
