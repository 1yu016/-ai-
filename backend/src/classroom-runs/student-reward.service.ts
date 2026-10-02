import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { Teacher } from '../auth/entities/teacher.entity';
import { Student } from '../platform/entities/student.entity';
import { ClassroomSnapshotService } from './classroom-snapshot.service';
import {
  ClassroomSnapshotReason,
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from './classroom-run.types';
import { ClassroomRun } from './entities/classroom-run.entity';
import { StudentRewardRecord } from './entities/student-reward-record.entity';
import { CreateClassroomRewardDto } from './dto/classroom-run.dto';

type RewardView = {
  id: number;
  studentId: number;
  studentName: string | null;
  classId: number;
  classroomRunId: number;
  teacherId: number;
  teacherName: string | null;
  rewardType: string;
  stars: number;
  reason: string | null;
  requestId: string;
  createdAt: Date;
};

@Injectable()
export class StudentRewardService {
  constructor(
    @InjectRepository(StudentRewardRecord)
    private readonly rewards: Repository<StudentRewardRecord>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(Teacher)
    private readonly teachers: Repository<Teacher>,
    private readonly dataSource: DataSource,
    private readonly snapshotService: ClassroomSnapshotService,
  ) {}

  /**
   * 给 run 内幼儿发奖励。
   * 原子性：RewardRecord 插入 + rewardState 快照更新在同一事务内完成；
   * 幂等 contract：(classroom_run_id, request_id) 唯一。
   *   - 相同 requestId + 相同 payload → 幂等成功，返回第一次的记录与当前 studentTotal，不重复加花；
   *   - 相同 requestId + 不同 payload（studentId/stars/reason 任一不同）→ 409 conflict，不允许伪装成功。
   * 并发兜底：两个相同请求同时通过预检、事务内 INSERT 撞 UNIQUE 时，catch 内重新查询已有记录，
   *   同 payload 同样按幂等成功返回（不再 capture snapshot / 不再 +stars），不同 payload 才抛 409。
   */
  async createReward(
    actor: JwtTeacherPayload,
    runId: number,
    dto: CreateClassroomRewardDto,
  ) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    // 幂等预检：双击 / 网络重试（串行情况）。同 payload 直接返回已有结果；不同 payload 视为 conflict。
    const preExisting = await this.rewards.findOne({
      where: { classroomRunId: runId, requestId: dto.requestId },
    });
    if (preExisting) {
      this.assertIdempotentPayload(dto, preExisting);
      return this.idempotentResult(runId, preExisting);
    }
    this.assertActive(run);

    const stars = dto.stars ?? 1;
    const reason = dto.reason?.trim() || null;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const runRepo = manager.getRepository(ClassroomRun);
        const current = await runRepo.findOne({ where: { id: runId } });
        if (!current) throw new NotFoundException('课堂运行不存在');
        if (current.teacherId !== actor.sub)
          throw new ForbiddenException('无权操作其他教师的课堂');
        this.assertActive(current);

        const rewardRepo = manager.getRepository(StudentRewardRecord);
        const dup = await rewardRepo.findOne({
          where: { classroomRunId: runId, requestId: dto.requestId },
        });
        if (dup) {
          this.assertIdempotentPayload(dto, dup);
          return this.buildResult(manager, current, dup);
        }

        const student = await manager
          .getRepository(Student)
          .findOne({ where: { id: dto.studentId } });
        if (!student) throw new NotFoundException('学生不存在');
        if (student.classId !== current.classId)
          throw new ForbiddenException('不能给本课堂之外的幼儿发奖励');

        const record = await rewardRepo.save(
          rewardRepo.create({
            studentId: student.id,
            classId: current.classId,
            classroomRunId: current.id,
            teacherId: current.teacherId,
            rewardType: 'flower',
            stars,
            reason,
            requestId: dto.requestId,
          }),
        );

        // 基于当前最新快照的 rewardState 增量更新，保证 rewardState 与流水同事务提交。
        const previous = await this.snapshotService.loadLatestValid(
          runId,
          manager,
        );
        const rewardState = { ...(previous?.rewardState ?? {}) };
        rewardState[student.id] =
          Number(rewardState[student.id] ?? 0) + stars;
        const captured = await this.snapshotService.capture(
          runId,
          ClassroomSnapshotReason.Reward,
          false,
          { rewardState },
          manager,
        );
        const finalState = captured?.rewardState ?? rewardState;
        return {
          record: this.serialize(record, student, current, await this.findTeacher(manager, current.teacherId)),
          rewardState: finalState,
          studentTotal: Number(finalState[student.id] ?? 0),
        };
      });
    } catch (error) {
      // 真正并发下唯一约束兜底：取已提交记录，同 payload 幂等返回，不同 payload 视为 conflict。
      if (this.isUniqueViolation(error)) {
        const existing = await this.rewards.findOne({
          where: { classroomRunId: runId, requestId: dto.requestId },
        });
        if (existing) {
          this.assertIdempotentPayload(dto, existing);
          return this.idempotentResult(runId, existing);
        }
      }
      throw error;
    }
  }

  /** 本节课奖励明细（按时间正序）。 */
  async listRunRewards(actor: JwtTeacherPayload, runId: number) {
    this.requireTeacher(actor);
    const run = await this.ownedRun(actor, runId);
    const records = await this.rewards.find({
      where: { classroomRunId: runId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const [students, teachers] = await Promise.all([
      this.students.find({
        where: { id: In([...new Set(records.map((r) => r.studentId))]) },
      }),
      this.teachers.find({
        where: { id: In([...new Set(records.map((r) => r.teacherId))]) },
      }),
    ]);
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));
    return {
      items: records.map((r) =>
        this.serialize(r, studentMap.get(r.studentId), run, teacherMap.get(r.teacherId)),
      ),
      total: records.length,
      runTitle: run.title,
    };
  }

  /** 幂等 contract：同 requestId 重放时校验 payload 是否与首次一致。 */
  private assertIdempotentPayload(
    dto: CreateClassroomRewardDto,
    record: StudentRewardRecord,
  ) {
    const stars = dto.stars ?? 1;
    const reason = dto.reason?.trim() || null;
    if (
      record.studentId !== dto.studentId ||
      record.stars !== stars ||
      record.reason !== reason
    ) {
      throw new ConflictException('同一 requestId 已用于不同的奖励请求');
    }
  }

  private async idempotentResult(runId: number, record: StudentRewardRecord) {
    const run = await this.runs.findOne({ where: { id: runId } });
    const latest = await this.snapshotService.loadLatestValid(runId);
    const student = await this.students.findOne({
      where: { id: record.studentId },
    });
    const teacher = await this.teachers.findOne({
      where: { id: record.teacherId },
    });
    return {
      record: this.serialize(record, student, run ?? null, teacher ?? null),
      rewardState: latest?.rewardState ?? {},
      studentTotal: Number(latest?.rewardState?.[record.studentId] ?? 0),
    };
  }

  private async buildResult(
    manager: EntityManager,
    run: ClassroomRun,
    record: StudentRewardRecord,
  ) {
    const latest = await this.snapshotService.loadLatestValid(run.id, manager);
    const student = await manager
      .getRepository(Student)
      .findOne({ where: { id: record.studentId } });
    const teacher = await this.findTeacher(manager, record.teacherId);
    return {
      record: this.serialize(record, student ?? null, run, teacher),
      rewardState: latest?.rewardState ?? {},
      studentTotal: Number(latest?.rewardState?.[record.studentId] ?? 0),
    };
  }

  private async findTeacher(manager: EntityManager, teacherId: number) {
    return manager.getRepository(Teacher).findOne({ where: { id: teacherId } });
  }

  private serialize(
    record: StudentRewardRecord,
    student: Student | null | undefined,
    run: ClassroomRun | null,
    teacher: Teacher | null | undefined,
  ): RewardView {
    return {
      id: record.id,
      studentId: record.studentId,
      studentName: student?.name ?? null,
      classId: record.classId,
      classroomRunId: record.classroomRunId,
      teacherId: record.teacherId,
      teacherName: teacher?.name ?? null,
      rewardType: record.rewardType,
      stars: record.stars,
      reason: record.reason,
      requestId: record.requestId,
      createdAt: record.createdAt,
    };
  }

  private async ownedRun(actor: JwtTeacherPayload, id: number) {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    if (run.teacherId !== actor.sub)
      throw new ForbiddenException('无权操作其他教师的课堂');
    return run;
  }

  private assertActive(run: ClassroomRun) {
    if (
      TERMINAL_CLASSROOM_RUN_STATUSES.includes(
        run.status as (typeof TERMINAL_CLASSROOM_RUN_STATUSES)[number],
      )
    )
      throw new ConflictException('已结束课堂不能继续发奖励');
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('课堂运行只能由教师操作');
  }

  private isUniqueViolation(error: unknown): boolean {
    // better-sqlite3 的唯一约束错误经 TypeORM 包装为 QueryFailedError，driver 原错误
    // 同时复制到了顶层（code='SQLITE_CONSTRAINT_UNIQUE'）；这里两层都查，避免驱动封装差异漏判。
    const driverError =
      typeof error === 'object' && error !== null && 'driverError' in error
        ? (error as { driverError?: { code?: unknown } }).driverError
        : null;
    const code =
      (typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '') ||
      (driverError && 'code' in driverError
        ? String((driverError as { code?: unknown }).code)
        : '');
    return code.includes('CONSTRAINT') || code === '23505';
  }
}
