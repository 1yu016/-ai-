import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { FindOptionsWhere, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { ClassroomCommandService } from '../classroom-runs/classroom-command.service';
import { ClassroomCommandOperation } from '../classroom-runs/classroom-command.types';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { AuditService } from '../platform/audit.service';
import { GuardianConsent } from '../platform/entities/guardian-consent.entity';
import { Student } from '../platform/entities/student.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { ConsentStatus, ConsentType, RecordStatus } from '../platform/platform.types';
import { resolveInside } from '../resources/resource-file.validation';
import { ARTWORK_UPLOAD_DIRECTORY, validateArtworkFile } from './artwork-file';
import { ArtworkListQueryDto, DeliverArtworkDto, UploadArtworkDto } from './dto/artwork.dto';
import { StudentArtworkRecord } from './entities/student-artwork-record.entity';
import { ArtworkVisionService, UNSAFE_ARTWORK_INFERENCE } from './artwork-vision.service';

@Injectable()
export class ArtworkService {
  constructor(
    @InjectRepository(StudentArtworkRecord) private readonly artworks: Repository<StudentArtworkRecord>,
    @InjectRepository(ClassroomRun) private readonly runRepo: Repository<ClassroomRun>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectRepository(GuardianConsent) private readonly consents: Repository<GuardianConsent>,
    private readonly access: PlatformAccessService,
    private readonly commands: ClassroomCommandService,
    private readonly vision: ArtworkVisionService,
    private readonly audit: AuditService,
  ) {}

  async upload(actor: JwtTeacherPayload, runId: number, dto: UploadArtworkDto, file?: Express.Multer.File) {
    try {
      this.requireTeacher(actor);
      const run = await this.requireOwnedRun(actor, runId);
      const student = await this.students.findOne({ where: { id: dto.studentId } });
      if (!student || student.classId !== run.classId || student.status !== RecordStatus.Active)
        throw new ForbiddenException('只能上传当前课堂班级中在读幼儿的作品');
      await this.requireGuardianConsents(student.id);
      const mimeType = await validateArtworkFile(file);
      const saved = await this.artworks.save(this.artworks.create({
        studentId: student.id,
        classId: run.classId,
        classroomRunId: run.id,
        lessonStepIndex: dto.lessonStepIndex ?? null,
        teacherId: actor.sub,
        storageKey: basename(file!.path),
        mimeType,
        originalName: basename(file!.originalname).slice(0, 255),
        aiDraft: null,
        teacherComment: null,
        confirmedAt: null,
      }));
      await this.audit.write(actor, { action: 'artwork.upload', targetType: 'student_artwork_record', targetId: saved.id, metadata: { runId, studentId: student.id, mimeType } });
      return { artwork: this.view(saved, actor.name) };
    } catch (error) {
      if (file?.path) await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  async generateDraft(actor: JwtTeacherPayload, artworkId: number) {
    const artwork = await this.requireOwned(actor, artworkId);
    const aiDraft = await this.vision.review(actor, { artworkId, path: this.filePath(artwork), mimeType: artwork.mimeType });
    artwork.aiDraft = aiDraft;
    await this.artworks.save(artwork);
    return { aiDraft };
  }

  async confirm(actor: JwtTeacherPayload, artworkId: number, rawComment: string) {
    const artwork = await this.requireOwned(actor, artworkId);
    const teacherComment = rawComment.trim();
    if (!teacherComment) throw new BadRequestException('教师评价不能为空');
    if (UNSAFE_ARTWORK_INFERENCE.test(teacherComment)) throw new BadRequestException('评价不能包含身份、家庭、心理、智力、人格、品行、诊断、评分或排名推断');
    artwork.teacherComment = teacherComment;
    artwork.confirmedAt = new Date();
    await this.artworks.save(artwork);
    await this.audit.write(actor, { action: 'artwork.confirm', targetType: 'student_artwork_record', targetId: artwork.id, metadata: { runId: artwork.classroomRunId, editedFromAiDraft: artwork.aiDraft !== teacherComment } });
    return { teacherComment, confirmedAt: artwork.confirmedAt.toISOString() };
  }

  async deliver(actor: JwtTeacherPayload, artworkId: number, dto: DeliverArtworkDto) {
    const artwork = await this.requireOwned(actor, artworkId);
    if (!artwork.confirmedAt || !artwork.teacherComment) throw new ConflictException('作品评价尚未由教师确认，不能展示或朗读');
    if (dto.targetDeviceId !== dto.deviceId) throw new ForbiddenException('只能投递到当前课堂大屏');
    const display = await this.commands.execute(actor, {
      requestId: `${dto.requestId}:display`, runId: artwork.classroomRunId, deviceId: dto.deviceId,
      targetDeviceId: dto.targetDeviceId, expectedVersion: dto.expectedVersion, source: dto.source,
      operation: ClassroomCommandOperation.DisplayArtwork, parameters: { artworkId: artwork.id },
    });
    const displayState = (display as { classroomState?: { version?: number } }).classroomState;
    const nextVersion = displayState?.version;
    if (!Number.isInteger(nextVersion)) throw new ConflictException('课堂状态版本无效，请刷新后重试');
    const speech = await this.commands.execute(actor, {
      requestId: `${dto.requestId}:tts`, runId: artwork.classroomRunId, deviceId: dto.deviceId,
      targetDeviceId: dto.targetDeviceId, expectedVersion: nextVersion!, source: dto.source,
      operation: ClassroomCommandOperation.SpeakText, parameters: { text: artwork.teacherComment, artworkId: artwork.id },
    });
    await this.audit.write(actor, { action: 'artwork.deliver', targetType: 'student_artwork_record', targetId: artwork.id, metadata: { runId: artwork.classroomRunId, targetDeviceId: dto.targetDeviceId } });
    return { display, speech };
  }

  async listRun(actor: JwtTeacherPayload, runId: number, query: ArtworkListQueryDto) {
    const run = await this.requireOwnedRun(actor, runId);
    return this.page({ classroomRunId: run.id }, query);
  }

  async listClass(actor: JwtTeacherPayload, classId: number, query: ArtworkListQueryDto) {
    await this.access.requireClassAccess(actor, classId);
    return this.page({ classId }, query);
  }

  async file(actor: JwtTeacherPayload, artworkId: number) {
    const artwork = await this.requireOwned(actor, artworkId, false);
    return { artwork, path: this.filePath(artwork) };
  }

  async requireForCommand(actor: JwtTeacherPayload, artworkId: number, runId: number) {
    const artwork = await this.requireOwned(actor, artworkId);
    if (artwork.classroomRunId !== runId) throw new ForbiddenException('作品不属于当前课堂');
    if (!artwork.confirmedAt || !artwork.teacherComment) throw new ConflictException('作品评价尚未确认');
    return artwork;
  }

  private async requireOwned(actor: JwtTeacherPayload, id: number, teacherOnly = true) {
    const artwork = await this.artworks.findOne({ where: { id } });
    if (!artwork) throw new NotFoundException('作品不存在');
    await this.access.requireClassAccess(actor, artwork.classId);
    if (teacherOnly && artwork.teacherId !== actor.sub) throw new ForbiddenException('不能修改其他教师上传的作品');
    return artwork;
  }

  private async requireOwnedRun(actor: JwtTeacherPayload, runId: number) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    await this.access.requireClassAccess(actor, run.classId);
    if (run.teacherId !== actor.sub) throw new ForbiddenException('不能操作其他教师的课堂');
    return run;
  }

  private async requireGuardianConsents(studentId: number) {
    const rows = await this.consents.find({ where: { studentId } });
    const granted = new Set(rows.filter((item) => item.status === ConsentStatus.Granted).map((item) => item.consentType));
    if (!granted.has(ConsentType.Photo) || !granted.has(ConsentType.Artwork))
      throw new ForbiddenException('监护人尚未同时授予照片和作品使用授权');
  }

  private async page(where: FindOptionsWhere<StudentArtworkRecord>, query: ArtworkListQueryDto) {
    const [items, total] = await this.artworks.findAndCount({ where, order: { createdAt: 'DESC', id: 'DESC' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize });
    return { items: items.map((item) => this.view(item)), total, page: query.page, pageSize: query.pageSize };
  }

  private filePath(artwork: StudentArtworkRecord) { return resolveInside(ARTWORK_UPLOAD_DIRECTORY, artwork.storageKey); }
  private view(item: StudentArtworkRecord, teacherName: string | null = null) {
    return { id: item.id, studentId: item.studentId, classId: item.classId, classroomRunId: item.classroomRunId, lessonStepIndex: item.lessonStepIndex, teacherId: item.teacherId, teacherName, fileUrl: `/artworks/${item.id}/file`, mimeType: item.mimeType, originalName: item.originalName, aiDraft: item.aiDraft, teacherComment: item.teacherComment, confirmedAt: item.confirmedAt?.toISOString() ?? null, createdAt: item.createdAt?.toISOString?.() ?? item.createdAt };
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher) throw new ForbiddenException('只有任课教师可以上传和评价作品');
  }
}
