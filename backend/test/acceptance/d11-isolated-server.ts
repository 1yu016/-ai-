/**
 * D-11 隔离验收用后端进程。
 *
 * 与 artwork-real-browser.e2e-spec.ts 使用同一批真实 Nest 模块、真实 SQLite 夹具与合成数据，
 * 只是把监听放到独立进程里，避免当前机器上 Jest/supertest 的 ENOTSOCK 绑定失败。
 * 只允许写入 integration-I1/backend/.tmp 下的隔离根目录，不接触正式数据库。
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import { AuthModule } from '../../src/auth/auth.module';
import { Administrator } from '../../src/auth/entities/administrator.entity';
import { AuthUserType, RefreshTokenSession } from '../../src/auth/entities/refresh-token-session.entity';
import { Teacher, TeacherRole } from '../../src/auth/entities/teacher.entity';
import { AVATAR_ENTITIES } from '../../src/avatars/avatar.module';
import { ARTWORK_UPLOAD_DIRECTORY } from '../../src/artworks/artwork-file';
import { ArtworkModule } from '../../src/artworks/artwork.module';
import { StudentArtworkRecord } from '../../src/artworks/entities/student-artwork-record.entity';
import { ClassroomMobileModule } from '../../src/classroom-mobile/classroom-mobile.module';
import { ClassroomControlSession } from '../../src/classroom-mobile/entities/classroom-control-session.entity';
import { CLASSROOM_RUN_ENTITIES, ClassroomRunModule } from '../../src/classroom-runs/classroom-run.module';
import { ClassroomRun } from '../../src/classroom-runs/entities/classroom-run.entity';
import { ClassroomRunStepSnapshot } from '../../src/classroom-runs/entities/classroom-run-step-snapshot.entity';
import { ClassroomRunStatus } from '../../src/classroom-runs/classroom-run.types';
import { TeachingResource, ResourceReviewStatus, ResourceType } from '../../src/data/entities/teaching-resource.entity';
import { OwnerType } from '../../src/data/owner.types';
import { ClassroomDialogueController } from '../../src/ai/classroom-dialogue.controller';
import { ClassroomDialogueService } from '../../src/ai/classroom-dialogue.service';
import { ClassroomContentSafetyService } from '../../src/ai/classroom-content-safety.service';
import { AiService } from '../../src/ai/ai.service';
import { LESSON_PLAN_ENTITIES, LessonPlanModule } from '../../src/lesson-plans/lesson-plan.module';
import { LessonPlanVersion } from '../../src/lesson-plans/entities/lesson-plan-version.entity';
import { LessonStepType } from '../../src/lesson-plans/lesson-plan.types';
import { Classroom } from '../../src/platform/entities/classroom.entity';
import { DeviceBinding } from '../../src/platform/entities/device-binding.entity';
import { Device } from '../../src/platform/entities/device.entity';
import { GuardianConsent } from '../../src/platform/entities/guardian-consent.entity';
import { SchoolClass } from '../../src/platform/entities/school-class.entity';
import { Student } from '../../src/platform/entities/student.entity';
import { TeacherClass } from '../../src/platform/entities/teacher-class.entity';
import { PLATFORM_ENTITIES, PlatformModule } from '../../src/platform/platform.module';
import { BindingStatus, ConsentStatus, ConsentType, DeviceStatus, DeviceType, RecordStatus, TeacherClassRole } from '../../src/platform/platform.types';
import { RESOURCE_ENTITIES, ResourceModule } from '../../src/resources/resource.module';
import { RESOURCE_UPLOAD_DIRECTORY } from '../../src/resources/resource-file.validation';
import { enterTeachingFixture } from '../helpers/teaching-phase-fixture';

const root = resolve(process.env.I24B_ROOT || 'INVALID');
if (!root.includes('integration-I1') || !root.includes('.tmp')) throw Error('Isolation root missing');
const database = join(root, 'acceptance.sqlite');
if (existsSync(database)) throw Error('Refusing to reuse a preexisting database');
if (resolve(ARTWORK_UPLOAD_DIRECTORY) !== join(root, 'uploads')) throw Error('Upload isolation mismatch');
if (RESOURCE_UPLOAD_DIRECTORY !== join(root, 'resources')) throw Error('Resource isolation mismatch');
mkdirSync(root, { recursive: true });
mkdirSync(join(root, 'resources'), { recursive: true });

const dialogueProvider = {
  reviewClassroomContent: async () => ({ decision: 'allow', ageAppropriate: true, privacySafe: true, noClassroomAction: true, contextAppropriate: true }),
  streamClassroomDialogue: async function* () { yield '我们一起看看合成教具的轮子吧。'; },
};
const entities = [...new Set([Teacher, Administrator, RefreshTokenSession, TeachingResource, ...PLATFORM_ENTITIES, ...RESOURCE_ENTITIES, ...LESSON_PLAN_ENTITIES, ...CLASSROOM_RUN_ENTITIES, ...AVATAR_ENTITIES, StudentArtworkRecord, ClassroomControlSession])];

async function main() {
  const initializer = new DataSource({ type: 'better-sqlite3', database, entities, synchronize: false, migrationsRun: false });
  await initializer.initialize();
  await initializer.synchronize();
  await initializer.destroy();

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, load: [() => ({
        DATABASE_PATH: database, DB_SYNCHRONIZE: 'false', DB_MIGRATIONS_RUN: 'false',
        JWT_ACCESS_SECRET: 'i24b-isolated-only-not-production-secret', JWT_ACCESS_EXPIRES_IN: '2h', JWT_REFRESH_EXPIRES_IN: '1d',
        TEST_TEACHER_ACCOUNT: 'i24b_synthetic', TEST_TEACHER_PASSWORD: 'Synthetic24b!', TEST_TEACHER_NAME: '合成验收教师',
      })] }),
      TypeOrmModule.forRoot({ type: 'better-sqlite3', database, entities, synchronize: false, migrationsRun: false }),
      AuthModule, PlatformModule, ResourceModule, LessonPlanModule, ClassroomRunModule, ArtworkModule, ClassroomMobileModule,
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ],
    controllers: [ClassroomDialogueController],
    providers: [ClassroomDialogueService, ClassroomContentSafetyService, { provide: AiService, useValue: dialogueProvider }],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  const db = app.get(DataSource);
  if (resolve(String(db.options.database)) !== database || db.options.synchronize || db.options.migrationsRun) throw Error('Actual DataSource mismatch');

  const teacher = await db.getRepository(Teacher).findOneByOrFail({ account: 'i24b_synthetic' });
  teacher.schoolId = 'i24b-only';
  await db.getRepository(Teacher).save(teacher);
  await db.getRepository(Teacher).save({ account: 'i24b_other', passwordHash: await bcrypt.hash('Synthetic24b!', 4), name: '合成无权限教师', role: TeacherRole.Teacher, schoolId: 'i24b-only' });
  const classId = (await db.getRepository(SchoolClass).save({ schoolId: 'i24b-only', name: '合成验收班', grade: '中班', ageRange: '4-5', schoolYear: '2026', status: RecordStatus.Active })).id;
  await db.getRepository(TeacherClass).save({ teacherId: teacher.id, classId, role: TeacherClassRole.Lead });
  const studentId = (await db.getRepository(Student).save({ classId, studentNo: 'I24B-SYNTH', name: '合成学生', status: RecordStatus.Active })).id;
  const second = await db.getRepository(Student).save({ classId, studentNo: 'D11-SECOND', name: '合成同学', status: RecordStatus.Active });
  const classroom = await db.getRepository(Classroom).save({ schoolId: 'i24b-only', name: '合成教室', roomCode: 'I24B', status: RecordStatus.Active });
  const deviceId = (await db.getRepository(Device).save({ schoolId: 'i24b-only', deviceCode: 'i24b-screen', name: '合成屏幕', type: DeviceType.ClassroomScreen, status: DeviceStatus.Online, lastOnlineAt: new Date() })).id;
  await db.getRepository(DeviceBinding).save({ deviceId, classroomId: classroom.id, classId, boundByType: AuthUserType.Teacher, boundBy: teacher.id, boundAt: new Date(), status: BindingStatus.Active });
  const runId = (await db.getRepository(ClassroomRun).save({ lessonPlanId: 1, lessonPlanVersion: 1, teacherId: teacher.id, classId, classroomId: classroom.id, deviceId, title: 'I24B 合成真实后端课堂', status: ClassroomRunStatus.Running, currentStepIndex: 0, startedAt: new Date(), resumedAt: new Date(), elapsedSeconds: 0, version: 1 })).id;
  await db.getRepository(ClassroomRunStepSnapshot).save({ classroomRunId: runId, originalStepId: 1, stepIndex: 0, title: '合成作品观察', type: LessonStepType.Introduction, content: '观察圆形', durationSeconds: 120 });
  await db.getRepository(GuardianConsent).save([ConsentType.Photo, ConsentType.Artwork].map(consentType => ({ studentId, consentType, status: ConsentStatus.Granted, consentedAt: new Date() })));
  await enterTeachingFixture(app, runId);

  // D-11 夹具：真实可播放的测试自有静音 WAV（不是付费 TTS 产物），以及第二步用于步骤过渡播报。
  const samples = 16000 * 6, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(600 * Math.sin(2 * Math.PI * 330 * i / 16000)), 44 + i * 2);
  writeFileSync(join(root, 'resources', 'd11.wav'), wav);
  await db.getRepository(LessonPlanVersion).save({ lessonPlanId: 1, versionNo: 1, snapshotJson: JSON.stringify({ title: '合成声音', objectives: '听一听声音', ageGroup: '4-5' }), createdBy: teacher.id, createdByType: AuthUserType.Teacher, changeSummary: 'D11 isolated frozen plan' });
  const resource = await db.getRepository(TeachingResource).save({
    ownerType: OwnerType.Teacher, ownerId: String(teacher.id), schoolId: 'i24b-only',
    title: 'D11 合成音频', category: '歌曲音乐', resourceType: ResourceType.Audio, reviewStatus: ResourceReviewStatus.Approved,
    fileUrl: '/uploads/resources/d11.wav', fileName: 'd11.wav', mimeType: 'audio/wav', fileSize: wav.length,
  });
  await db.getRepository(ClassroomRunStepSnapshot).update({ classroomRunId: runId, stepIndex: 0 }, { title: '听一听声音', content: '认识声音', resourceId: resource.id });
  await db.getRepository(ClassroomRunStepSnapshot).save({ classroomRunId: runId, originalStepId: 2, stepIndex: 1, title: '第二教学环节', type: LessonStepType.Introduction, content: '观察方形', durationSeconds: 120 });

  await app.listen(3189, '127.0.0.1');
  writeFileSync(join(root, 'environment.json'), JSON.stringify({
    pid: process.pid, cwd: process.cwd(), database: db.options.database, databaseList: await db.query('PRAGMA database_list'),
    synchronize: db.options.synchronize, migrationsRun: db.options.migrationsRun,
    uploadPath: ARTWORK_UPLOAD_DIRECTORY, resourcePath: RESOURCE_UPLOAD_DIRECTORY, backendPort: 3189,
    classId, studentId, deviceId, runId, source: 'real Nest modules in a standalone isolated process, not dist',
  }, null, 2));
  writeFileSync(join(root, 'd11-meta.json'), JSON.stringify({ root, runId, deviceId, classId, studentId, resourceId: resource.id, secondStudentId: second.id, secondStudentName: second.name }, null, 2));
  console.log('D11_SERVER_READY', JSON.stringify({ runId, deviceId, resourceId: resource.id }));
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

void main();
