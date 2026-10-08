import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DataSource, In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { Teacher } from '../auth/entities/teacher.entity';
import {
  AuditLogQueryDto,
  BindDeviceDto,
  BindTeacherDto,
  ClassQueryDto,
  ClassRewardQueryDto,
  ConsentQueryDto,
  CreateClassDto,
  CreateClassroomDto,
  CreateDeviceDto,
  CreateStudentDto,
  CreateTeacherDto,
  CreateTicketDto,
  StudentQueryDto,
  SyncStudentsDto,
  TeacherQueryDto,
  UpdateClassDto,
  UpdateClassroomDto,
  UpdateDeviceDto,
  UpdateStudentDto,
  UpdateTeacherDto,
  UpsertConsentDto,
} from './dto/platform.dto';
import { StudentRewardRecord } from '../classroom-runs/entities/student-reward-record.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { AiCallLog } from './entities/ai-call-log.entity';
import { AuditLog } from './entities/audit-log.entity';
import { ClassroomTicket } from './entities/classroom-ticket.entity';
import { Classroom } from './entities/classroom.entity';
import { DeviceBinding } from './entities/device-binding.entity';
import { Device } from './entities/device.entity';
import { GuardianConsent } from './entities/guardian-consent.entity';
import { SchoolClass } from './entities/school-class.entity';
import { Student } from './entities/student.entity';
import { TeacherClass } from './entities/teacher-class.entity';
import { AuditService } from './audit.service';
import { PlatformAccessService } from './platform-access.service';
import {
  BindingStatus,
  ConsentStatus,
  DeviceStatus,
  DeviceType,
  RecordStatus,
} from './platform.types';
import {
  ACTIVE_CLASSROOM_RUN_STATUSES,
  TERMINAL_CLASSROOM_RUN_STATUSES,
} from '../classroom-runs/classroom-run.types';

@Injectable()
export class PlatformService {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly access: PlatformAccessService,
    private readonly audit: AuditService,
    @InjectRepository(Teacher) private readonly teachers: Repository<Teacher>,
    @InjectRepository(SchoolClass)
    private readonly classes: Repository<SchoolClass>,
    @InjectRepository(TeacherClass)
    private readonly teacherClasses: Repository<TeacherClass>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectRepository(Classroom)
    private readonly classrooms: Repository<Classroom>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(DeviceBinding)
    private readonly bindings: Repository<DeviceBinding>,
    @InjectRepository(ClassroomTicket)
    private readonly tickets: Repository<ClassroomTicket>,
    @InjectRepository(GuardianConsent)
    private readonly consents: Repository<GuardianConsent>,
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(AiCallLog)
    private readonly aiCallLogs: Repository<AiCallLog>,
    @InjectRepository(StudentRewardRecord)
    private readonly rewards: Repository<StudentRewardRecord>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
  ) {}

  private get heartbeatTimeoutMs(): number {
    const seconds = Number(
      this.config.get<string>('DEVICE_HEARTBEAT_TIMEOUT_SECONDS') ?? '90',
    );
    return (Number.isFinite(seconds) && seconds >= 15 ? seconds : 90) * 1000;
  }

  async createClass(actor: JwtTeacherPayload, dto: CreateClassDto) {
    this.access.requireAdministrator(actor);
    const schoolId = actor.schoolId ?? dto.schoolId ?? null;
    const saved = await this.classes.save(
      this.classes.create({
        ...dto,
        schoolId,
        grade: dto.grade ?? null,
        ageRange: dto.ageRange ?? null,
      }),
    );
    await this.audit.write(actor, {
      action: 'class.create',
      targetType: 'class',
      targetId: saved.id,
    });
    return saved;
  }

  async updateClass(actor: JwtTeacherPayload, id: number, dto: UpdateClassDto) {
    this.access.requireAdministrator(actor);
    const entity = await this.access.requireClassAccess(actor, id);
    const saved = await this.classes.save(this.classes.merge(entity, dto));
    await this.audit.write(actor, {
      action: 'class.update',
      targetType: 'class',
      targetId: id,
    });
    return saved;
  }

  async classDetail(actor: JwtTeacherPayload, id: number) {
    return this.access.requireClassAccess(actor, id);
  }

  async listClasses(actor: JwtTeacherPayload, query: ClassQueryDto) {
    const builder = this.classes.createQueryBuilder('c');
    if (!this.access.isAdministrator(actor)) {
      builder.innerJoin(
        TeacherClass,
        'tc',
        'tc.class_id = c.id AND tc.teacher_id = :teacherId',
        { teacherId: actor.sub },
      );
    } else if (actor.schoolId) {
      builder.andWhere('c.school_id = :schoolId', { schoolId: actor.schoolId });
    }
    if (query.status)
      builder.andWhere('c.status = :status', { status: query.status });
    const [items, total] = await builder
      .orderBy('c.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async bindTeacher(
    actor: JwtTeacherPayload,
    classId: number,
    dto: BindTeacherDto,
  ) {
    this.access.requireAdministrator(actor);
    const schoolClass = await this.access.requireClassAccess(actor, classId);
    const teacher = await this.teachers.findOne({
      where: { id: dto.teacherId },
    });
    if (!teacher) throw new NotFoundException('教师不存在');
    if (
      schoolClass.schoolId &&
      teacher.schoolId &&
      schoolClass.schoolId !== teacher.schoolId
    )
      throw new ConflictException('教师与班级不属于同一园所');
    const existing = await this.teacherClasses.findOne({
      where: { teacherId: dto.teacherId, classId },
    });
    const saved = await this.teacherClasses.save(
      existing
        ? this.teacherClasses.merge(existing, { role: dto.role })
        : this.teacherClasses.create({
            teacherId: dto.teacherId,
            classId,
            role: dto.role,
          }),
    );
    await this.audit.write(actor, {
      action: 'teacher_class.bind',
      targetType: 'teacher_class',
      targetId: saved.id,
    });
    return saved;
  }

  async unbindTeacher(
    actor: JwtTeacherPayload,
    classId: number,
    teacherId: number,
  ): Promise<void> {
    this.access.requireAdministrator(actor);
    await this.access.requireClassAccess(actor, classId);
    const result = await this.teacherClasses.delete({ classId, teacherId });
    if (!result.affected) throw new NotFoundException('教师班级关系不存在');
    await this.audit.write(actor, {
      action: 'teacher_class.unbind',
      targetType: 'class',
      targetId: classId,
      metadata: { teacherId },
    });
  }

  async classTeachers(actor: JwtTeacherPayload, classId: number) {
    await this.access.requireClassAccess(actor, classId);
    return this.teacherClasses
      .createQueryBuilder('tc')
      .innerJoinAndSelect(Teacher, 't', 't.id = tc.teacher_id')
      .select([
        'tc.id AS relationId',
        'tc.role AS role',
        't.id AS teacherId',
        't.name AS name',
        't.account AS account',
      ])
      .where('tc.class_id = :classId', { classId })
      .getRawMany();
  }

  /** Stage 7.3：班级成长奖励历史（按幼儿可筛选，含累计）。 */
  async listClassRewards(
    actor: JwtTeacherPayload,
    classId: number,
    query: ClassRewardQueryDto,
  ) {
    const schoolClass = await this.access.requireClassAccess(actor, classId);
    const builder = this.rewards
      .createQueryBuilder('r')
      .where('r.class_id = :classId', { classId })
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC');
    if (query.studentId)
      builder.andWhere('r.student_id = :studentId', {
        studentId: query.studentId,
      });
    const [records, total] = await builder
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    const summaryRow = (await this.rewards
      .createQueryBuilder('r')
      .select('COALESCE(SUM(CASE WHEN r.revoked_at IS NULL THEN r.stars ELSE 0 END), 0)', 'totalStars')
      .addSelect('COALESCE(SUM(CASE WHEN r.revoked_at IS NULL THEN r.points ELSE 0 END), 0)', 'totalPoints')
      .where('r.class_id = :classId', { classId })
      .getRawOne<{ totalStars: number | string; totalPoints: number | string }>()) ?? { totalStars: 0, totalPoints: 0 };
    const studentIds = [...new Set(records.map((r) => r.studentId))];
    const runIds = [...new Set(records.map((r) => r.classroomRunId))];
    const teacherIds = [...new Set(records.map((r) => r.teacherId))];
    const [students, runs, teachers] = await Promise.all([
      studentIds.length
        ? this.students.find({ where: { id: In(studentIds) } })
        : Promise.resolve([]),
      runIds.length
        ? this.runs.find({ where: { id: In(runIds) } })
        : Promise.resolve([]),
      teacherIds.length
        ? this.teachers.find({ where: { id: In(teacherIds) } })
        : Promise.resolve([]),
    ]);
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const runMap = new Map(runs.map((run) => [run.id, run]));
    const teacherMap = new Map(teachers.map((t) => [t.id, t]));
    const items = records.map((r) => {
      const run = runMap.get(r.classroomRunId);
      return {
        id: r.id,
        studentId: r.studentId,
        studentName: studentMap.get(r.studentId)?.name ?? null,
        classId: r.classId,
        classroomRunId: r.classroomRunId,
        lessonTitle: run?.title ?? null,
        runAt: run?.startedAt ?? run?.createdAt ?? null,
        teacherId: r.teacherId,
        teacherName: teacherMap.get(r.teacherId)?.name ?? null,
        rewardType: r.rewardType,
        rewardCategory: r.rewardCategory,
        rewardForms: (() => { try { return JSON.parse(r.rewardForms) as string[]; } catch { return ['flower']; } })(),
        points: r.points,
        badgeCode: r.badgeCode,
        praiseText: r.praiseText,
        animationKey: r.animationKey,
        stars: r.stars,
        reason: r.reason,
        revokedAt: r.revokedAt,
        revokedByTeacherId: r.revokedByTeacherId,
        revokeReason: r.revokeReason,
        createdAt: r.createdAt,
      };
    });
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      summary: {
        classId,
        className: schoolClass.name,
        totalStars: Number(summaryRow.totalStars),
        totalPoints: Number(summaryRow.totalPoints),
      },
    };
  }

  async listTeachers(actor: JwtTeacherPayload, query: TeacherQueryDto) {
    this.access.requireAdministrator(actor);
    const builder = this.teachers.createQueryBuilder('t');
    if (actor.schoolId) builder.andWhere('t.school_id = :schoolId', { schoolId: actor.schoolId });
    if (query.status) builder.andWhere('t.status = :status', { status: query.status });
    if (query.keyword) {
      builder.andWhere(
        '(t.account LIKE :k OR t.name LIKE :k)',
        { k: `%${query.keyword}%` },
      );
    }
    const [teachers, total] = await builder
      .orderBy('t.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    const classMap = await this.buildTeacherClassMap(teachers.map((t) => t.id));
    const items = teachers.map((t) => ({
      id: t.id,
      account: t.account,
      name: t.name,
      role: t.role,
      status: t.status,
      schoolId: t.schoolId,
      classes: classMap.get(t.id) ?? [],
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async createTeacherAccount(actor: JwtTeacherPayload, dto: CreateTeacherDto) {
    this.access.requireAdministrator(actor);
    const existing = await this.teachers.findOne({
      where: { account: dto.account },
    });
    if (existing) throw new ConflictException('账号已存在');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const saved = await this.teachers.save(
      this.teachers.create({
        account: dto.account,
        passwordHash,
        name: dto.name,
        role: dto.role,
        schoolId: actor.schoolId ?? dto.schoolId ?? null,
      }),
    );
    await this.audit.write(actor, {
      action: 'teacher.create',
      targetType: 'teacher',
      targetId: saved.id,
    });
    return { id: saved.id, account: saved.account, name: saved.name, role: saved.role, status: saved.status };
  }

  async updateTeacher(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateTeacherDto,
  ) {
    this.access.requireAdministrator(actor);
    const entity = await this.teachers.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('教师不存在');
    const saved = await this.teachers.save(this.teachers.merge(entity, dto));
    await this.audit.write(actor, {
      action: 'teacher.update',
      targetType: 'teacher',
      targetId: id,
    });
    return { id: saved.id, account: saved.account, name: saved.name, role: saved.role, status: saved.status };
  }

  private async buildTeacherClassMap(
    teacherIds: number[],
  ): Promise<Map<number, { classId: number; className: string; role: string }[]>> {
    const map = new Map<number, { classId: number; className: string; role: string }[]>();
    if (!teacherIds.length) return map;
    const rows = await this.teacherClasses
      .createQueryBuilder('tc')
      .innerJoin(SchoolClass, 'c', 'c.id = tc.class_id')
      .select([
        'tc.teacher_id AS teacherId',
        'tc.class_id AS classId',
        'tc.role AS role',
        'c.name AS className',
      ])
      .where('tc.teacher_id IN (:...ids)', { ids: teacherIds })
      .getRawMany<{ teacherId: number; classId: number; role: string; className: string }>();
    for (const row of rows) {
      const list = map.get(Number(row.teacherId)) ?? [];
      list.push({ classId: Number(row.classId), className: row.className, role: row.role });
      map.set(Number(row.teacherId), list);
    }
    return map;
  }

  async createStudent(actor: JwtTeacherPayload, dto: CreateStudentDto) {
    await this.access.requireClassAccess(actor, dto.classId);
    const saved = await this.students.save(
      this.students.create({
        ...dto,
        nickname: dto.nickname ?? null,
        gender: dto.gender ?? null,
        birthday: dto.birthday ?? null,
      }),
    );
    await this.audit.write(actor, {
      action: 'student.create',
      targetType: 'student',
      targetId: saved.id,
    });
    return this.studentSummary(saved);
  }

  async updateStudent(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateStudentDto,
  ) {
    const entity = await this.access.requireStudentAccess(actor, id);
    const saved = await this.students.save(this.students.merge(entity, dto));
    await this.audit.write(actor, {
      action: 'student.update',
      targetType: 'student',
      targetId: id,
    });
    return this.studentSummary(saved);
  }

  async listStudents(actor: JwtTeacherPayload, query: StudentQueryDto) {
    await this.access.requireClassAccess(actor, query.classId);
    const where = {
      classId: query.classId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.students.findAndCount({
      where,
      order: { id: 'ASC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return {
      items: items.map((item) => this.studentSummary(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async syncStudents(actor: JwtTeacherPayload, dto: SyncStudentsDto) {
    await this.access.requireClassAccess(actor, dto.classId);
    const counts = { created: 0, updated: 0, unchanged: 0 };
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Student);
      for (const item of dto.students) {
        const existing = await repository.findOne({
          where: { classId: dto.classId, studentNo: item.studentNo },
        });
        const next = {
          ...item,
          classId: dto.classId,
          nickname: item.nickname ?? null,
          gender: item.gender ?? null,
          birthday: item.birthday ?? null,
          status: item.status ?? RecordStatus.Active,
        };
        if (!existing) {
          await repository.save(repository.create(next));
          counts.created += 1;
        } else {
          const changed = [
            'name',
            'nickname',
            'gender',
            'birthday',
            'status',
          ].some(
            (key) =>
              String(existing[key as keyof Student] ?? '') !==
              String(next[key as keyof typeof next] ?? ''),
          );
          if (changed) {
            await repository.save(repository.merge(existing, next));
            counts.updated += 1;
          } else counts.unchanged += 1;
        }
      }
    });
    await this.audit.write(actor, {
      action: 'student.sync',
      targetType: 'class',
      targetId: dto.classId,
      metadata: counts,
    });
    return counts;
  }

  async createClassroom(actor: JwtTeacherPayload, dto: CreateClassroomDto) {
    this.access.requireAdministrator(actor);
    const saved = await this.classrooms.save(
      this.classrooms.create({
        ...dto,
        schoolId: actor.schoolId ?? dto.schoolId ?? null,
        location: dto.location ?? null,
      }),
    );
    await this.audit.write(actor, {
      action: 'classroom.create',
      targetType: 'classroom',
      targetId: saved.id,
    });
    return saved;
  }

  async updateClassroom(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateClassroomDto,
  ) {
    this.access.requireAdministrator(actor);
    const entity = await this.classrooms.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('教室不存在');
    this.requireSameSchool(actor, entity.schoolId);
    const saved = await this.classrooms.save(
      this.classrooms.merge(entity, dto),
    );
    await this.audit.write(actor, {
      action: 'classroom.update',
      targetType: 'classroom',
      targetId: id,
    });
    return saved;
  }

  async listClassrooms(actor: JwtTeacherPayload) {
    if (this.access.isAdministrator(actor))
      return this.classrooms.find({
        where: actor.schoolId ? { schoolId: actor.schoolId } : {},
        order: { id: 'DESC' },
      });
    return this.classrooms
      .createQueryBuilder('room')
      .innerJoin(
        DeviceBinding,
        'b',
        'b.classroom_id = room.id AND b.status = :status',
        { status: BindingStatus.Active },
      )
      .innerJoin(
        TeacherClass,
        'tc',
        'tc.class_id = b.class_id AND tc.teacher_id = :teacherId',
        { teacherId: actor.sub },
      )
      .distinct(true)
      .getMany();
  }

  async createDevice(actor: JwtTeacherPayload, dto: CreateDeviceDto) {
    this.access.requireAdministrator(actor);
    const saved = await this.devices.save(
      this.devices.create({
        ...dto,
        schoolId: actor.schoolId ?? dto.schoolId ?? null,
      }),
    );
    await this.audit.write(actor, {
      action: 'device.create',
      targetType: 'device',
      targetId: saved.id,
    });
    return saved;
  }

  async updateDevice(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateDeviceDto,
  ) {
    this.access.requireAdministrator(actor);
    const entity = await this.devices.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('设备不存在');
    this.requireSameSchool(actor, entity.schoolId);
    const saved = await this.devices.save(this.devices.merge(entity, dto));
    await this.audit.write(actor, {
      action: 'device.update',
      targetType: 'device',
      targetId: id,
    });
    return saved;
  }

  async listDevices(actor: JwtTeacherPayload) {
    if (this.access.isAdministrator(actor)) {
      const devices = await this.devices.find({
        where: actor.schoolId ? { schoolId: actor.schoolId } : {},
        order: { id: 'DESC' },
      });
      return this.deviceSummaries(devices);
    }
    const devices = await this.devices
      .createQueryBuilder('d')
      .innerJoin(
        DeviceBinding,
        'b',
        'b.device_id = d.id AND b.status = :status',
        { status: BindingStatus.Active },
      )
      .innerJoin(
        TeacherClass,
        'tc',
        'tc.class_id = b.class_id AND tc.teacher_id = :teacherId',
        { teacherId: actor.sub },
      )
      .distinct(true)
      .getMany();
    return this.deviceSummaries(devices);
  }

  async heartbeat(
    actor: JwtTeacherPayload,
    deviceId: number,
    deviceCode: string,
  ) {
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('设备不存在');
    this.requireSameSchool(actor, device.schoolId);
    if (deviceCode !== device.deviceCode)
      throw new ForbiddenException('设备身份校验失败');
    if (!this.access.isAdministrator(actor)) {
      const binding = await this.bindings.findOne({
        where: { deviceId, status: BindingStatus.Active },
      });
      if (!binding) throw new ForbiddenException('设备尚未绑定到当前教师班级');
      await this.access.requireClassAccess(actor, binding.classId);
    }
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      throw new ConflictException('停用或故障设备不能参与课堂');
    device.lastOnlineAt = new Date();
    device.status = DeviceStatus.Online;
    const saved = await this.devices.save(device);
    return this.deviceStatusSummary(saved);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async markTimedOutDevicesOffline(): Promise<void> {
    const cutoff = new Date(Date.now() - this.heartbeatTimeoutMs);
    await this.devices
      .createQueryBuilder()
      .update(Device)
      .set({ status: DeviceStatus.Offline })
      .where('status = :online', { online: DeviceStatus.Online })
      .andWhere('(last_online_at IS NULL OR last_online_at < :cutoff)', {
        cutoff,
      })
      .execute();
  }

  async bindDevice(actor: JwtTeacherPayload, dto: BindDeviceDto) {
    this.access.requireAdministrator(actor);
    const [device, classroom] = await Promise.all([
      this.devices.findOne({ where: { id: dto.deviceId } }),
      this.classrooms.findOne({ where: { id: dto.classroomId } }),
    ]);
    if (!device) throw new NotFoundException('设备不存在');
    if (!classroom) throw new NotFoundException('教室不存在');
    const schoolClass = await this.access.requireClassAccess(
      actor,
      dto.classId,
    );
    this.requireSameSchool(actor, device.schoolId);
    this.requireSameSchool(actor, classroom.schoolId);
    const schoolIds = [
      schoolClass.schoolId,
      device.schoolId,
      classroom.schoolId,
    ].filter((schoolId): schoolId is string => Boolean(schoolId));
    if (new Set(schoolIds).size > 1)
      throw new ConflictException('设备、教室与班级不属于同一园所');
    const active = await this.bindings.findOne({
      where: { deviceId: dto.deviceId, status: BindingStatus.Active },
    });
    if (active) throw new ConflictException('设备已经存在有效绑定');
    const saved = await this.bindings.save(
      this.bindings.create({
        ...dto,
        boundByType: actor.userType,
        boundBy: actor.sub,
        boundAt: new Date(),
        unboundAt: null,
        status: BindingStatus.Active,
      }),
    );
    await this.audit.write(actor, {
      action: 'device.bind',
      targetType: 'device_binding',
      targetId: saved.id,
    });
    return saved;
  }

  async unbindDevice(
    actor: JwtTeacherPayload,
    bindingId: number,
  ): Promise<void> {
    this.access.requireAdministrator(actor);
    const binding = await this.bindings.findOne({
      where: { id: bindingId, status: BindingStatus.Active },
    });
    if (!binding) throw new NotFoundException('有效设备绑定不存在');
    await this.access.requireClassAccess(actor, binding.classId);
    const [device, classroom] = await Promise.all([
      this.devices.findOne({ where: { id: binding.deviceId } }),
      this.classrooms.findOne({ where: { id: binding.classroomId } }),
    ]);
    if (!device) throw new NotFoundException('设备不存在');
    if (!classroom) throw new NotFoundException('教室不存在');
    this.requireSameSchool(actor, device.schoolId);
    this.requireSameSchool(actor, classroom.schoolId);
    binding.status = BindingStatus.Unbound;
    binding.unboundAt = new Date();
    await this.bindings.save(binding);
    await this.audit.write(actor, {
      action: 'device.unbind',
      targetType: 'device_binding',
      targetId: bindingId,
    });
  }

  async deviceContext(actor: JwtTeacherPayload, deviceCode: string) {
    const device = await this.devices.findOne({ where: { deviceCode } });
    if (!device) throw new NotFoundException('设备不存在');
    const binding = await this.bindings.findOne({
      where: { deviceId: device.id, status: BindingStatus.Active },
    });
    if (!binding)
      return { device, binding: null, classroom: null, class: null };
    await this.access.requireClassAccess(actor, binding.classId);
    const [classroom, schoolClass] = await Promise.all([
      this.classrooms.findOne({ where: { id: binding.classroomId } }),
      this.classes.findOne({ where: { id: binding.classId } }),
    ]);
    return { device, binding, classroom, class: schoolClass };
  }

  async listClassDeviceBindings(
    actor: JwtTeacherPayload,
    classId: number,
  ) {
    await this.access.requireClassAccess(actor, classId);
    const bindings = await this.bindings.find({
      where: { classId, status: BindingStatus.Active },
      order: { id: 'ASC' },
    });
    if (!bindings.length) return [];
    const [devices, classrooms] = await Promise.all([
      this.devices.find({ where: { id: In(bindings.map((b) => b.deviceId)) } }),
      this.classrooms.find({
        where: { id: In(bindings.map((b) => b.classroomId)) },
      }),
    ]);
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    const classroomById = new Map(classrooms.map((c) => [c.id, c]));
    return bindings.map((b) => {
      const device = deviceById.get(b.deviceId);
      const classroom = classroomById.get(b.classroomId);
      const deviceSummary = device ? this.deviceStatusSummary(device) : null;
      return {
        id: b.id,
        classId: b.classId,
        classroomId: b.classroomId,
        classroom: classroom ? { id: classroom.id, name: classroom.name } : null,
        deviceId: b.deviceId,
        device: deviceSummary
          ? {
              id: deviceSummary.id,
              deviceCode: deviceSummary.deviceCode,
              name: deviceSummary.name,
              type: deviceSummary.type,
              status: deviceSummary.status,
              online: deviceSummary.online,
              lastOnlineAt: deviceSummary.lastOnlineAt,
            }
          : null,
      };
    });
  }

  async createTicket(actor: JwtTeacherPayload, dto: CreateTicketDto) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('课堂扫码凭证只能由教师生成');
    await this.access.requireClassAccess(actor, dto.classId);
    const [binding, device, activeRun] = await Promise.all([
      this.bindings.findOne({
        where: {
          deviceId: dto.deviceId,
          classroomId: dto.classroomId,
          classId: dto.classId,
          status: BindingStatus.Active,
        },
      }),
      this.devices.findOne({ where: { id: dto.deviceId } }),
      this.runs.findOne({
        where: {
          deviceId: dto.deviceId,
          status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]),
        },
      }),
    ]);
    if (!binding) throw new ConflictException('设备、教室与班级不存在有效绑定');
    if (!device) throw new NotFoundException('设备不存在');
    if (device.type !== DeviceType.ClassroomScreen)
      throw new ConflictException('只有课堂大屏可以生成扫码凭证');
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      throw new ConflictException('停用或故障设备不能参与课堂');
    if (
      activeRun &&
      (activeRun.classId !== dto.classId ||
        activeRun.classroomId !== dto.classroomId ||
        (dto.lessonRunId != null && activeRun.id !== dto.lessonRunId))
    )
      throw new ConflictException('该大屏已有进行中的课堂');
    if (dto.lessonRunId != null && !activeRun)
      throw new ConflictException('指定课堂不存在或已经结束');
    const ticket = randomBytes(32).toString('base64url');
    const entity = await this.tickets.save(
      this.tickets.create({
        ticketHash: this.hash(ticket),
        deviceId: dto.deviceId,
        classroomId: dto.classroomId,
        classId: dto.classId,
        lessonRunId: activeRun?.id ?? dto.lessonRunId ?? null,
        expiresAt: new Date(Date.now() + dto.expiresInSeconds * 1000),
        usedAt: null,
        isUsed: false,
        createdBy: actor.sub,
      }),
    );
    await this.audit.write(actor, {
      action: 'classroom_ticket.create',
      targetType: 'classroom_ticket',
      targetId: entity.id,
    });
    return {
      ticket,
      expiresAt: entity.expiresAt,
      deviceCode: device.deviceCode,
    };
  }

  async consumeTicket(
    actor: JwtTeacherPayload,
    ticket: string,
    deviceCode: string,
  ) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('只有教师可以扫码进入课堂');
    return this.dataSource.transaction(async (manager) => {
      const tickets = manager.getRepository(ClassroomTicket);
      const entity = await tickets.findOne({
        where: { ticketHash: this.hash(ticket) },
      });
      const device = await manager
        .getRepository(Device)
        .findOne({ where: { deviceCode } });
      if (
        !entity ||
        !device ||
        entity.deviceId !== device.id ||
        entity.isUsed ||
        entity.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException('课堂凭证无效或已过期');
      }
      await this.access.requireClassAccess(actor, entity.classId);
      if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
        throw new BadRequestException('课堂凭证无效或已过期');
      const runs = manager.getRepository(ClassroomRun);
      if (entity.lessonRunId != null) {
        const linkedRun = await runs.findOne({
          where: { id: entity.lessonRunId },
        });
        if (
          !linkedRun ||
          linkedRun.classId !== entity.classId ||
          linkedRun.classroomId !== entity.classroomId ||
          linkedRun.deviceId !== entity.deviceId ||
          !ACTIVE_CLASSROOM_RUN_STATUSES.includes(
            linkedRun.status as (typeof ACTIVE_CLASSROOM_RUN_STATUSES)[number],
          )
        )
          throw new BadRequestException('课堂凭证无效或已过期');
        if (linkedRun.teacherId !== actor.sub)
          throw new ForbiddenException('只有当前课堂教师可以使用该凭证');
      } else {
        const endedAfterIssue = await runs
          .createQueryBuilder('run')
          .where('run.device_id = :deviceId', { deviceId: entity.deviceId })
          .andWhere('run.class_id = :classId', { classId: entity.classId })
          .andWhere('run.classroom_id = :classroomId', {
            classroomId: entity.classroomId,
          })
          .andWhere('run.status IN (:...terminalStatuses)', {
            terminalStatuses: [...TERMINAL_CLASSROOM_RUN_STATUSES],
          })
          .andWhere('run.ended_at IS NOT NULL')
          .andWhere('run.ended_at >= :createdAt', {
            createdAt: entity.createdAt,
          })
          .getOne();
        if (endedAfterIssue)
          throw new BadRequestException('课堂凭证无效或已过期');
      }
      const updated = await tickets
        .createQueryBuilder()
        .update(ClassroomTicket)
        .set({ isUsed: true, usedAt: new Date() })
        .where('id = :id AND is_used = :unused', {
          id: entity.id,
          unused: false,
        })
        .execute();
      if (updated.affected !== 1)
        throw new BadRequestException('课堂凭证无效或已过期');
      const binding = await manager.getRepository(DeviceBinding).findOne({
        where: {
          deviceId: device.id,
          classroomId: entity.classroomId,
          classId: entity.classId,
          status: BindingStatus.Active,
        },
      });
      if (!binding) throw new BadRequestException('课堂凭证无效或已过期');
      return {
        classId: entity.classId,
        classroomId: entity.classroomId,
        deviceId: entity.deviceId,
        lessonRunId: entity.lessonRunId,
        deviceCode: device.deviceCode,
      };
    });
  }

  async upsertConsent(actor: JwtTeacherPayload, dto: UpsertConsentDto) {
    await this.access.requireStudentAccess(actor, dto.studentId);
    const existing = await this.consents.findOne({
      where: { studentId: dto.studentId, consentType: dto.consentType },
    });
    const now = new Date();
    const values = {
      ...dto,
      note: dto.note ?? null,
      consentedAt:
        dto.status === ConsentStatus.Granted
          ? now
          : (existing?.consentedAt ?? null),
      revokedAt: dto.status === ConsentStatus.Revoked ? now : null,
    };
    const saved = await this.consents.save(
      existing
        ? this.consents.merge(existing, values)
        : this.consents.create(values),
    );
    await this.audit.write(actor, {
      action: 'guardian_consent.update',
      targetType: 'student',
      targetId: dto.studentId,
      metadata: { consentType: dto.consentType, status: dto.status },
    });
    return saved;
  }

  async listConsents(actor: JwtTeacherPayload, query: ConsentQueryDto) {
    await this.access.requireStudentAccess(actor, query.studentId);
    return this.consents.find({
      where: { studentId: query.studentId },
      order: { consentType: 'ASC' },
    });
  }

  async listAuditLogs(
    actor: JwtTeacherPayload,
    query: AuditLogQueryDto,
  ) {
    this.access.requireAdministrator(actor);
    const builder = this.auditLogs.createQueryBuilder('log');
    if (actor.schoolId)
      builder.andWhere(
        `((log.actor_type = 'teacher' AND log.actor_id IN
          (SELECT id FROM teachers WHERE school_id = :auditSchoolId))
         OR (log.actor_type = 'administrator' AND log.actor_id IN
          (SELECT id FROM administrator WHERE school_id = :auditSchoolId)))`,
        { auditSchoolId: actor.schoolId },
      );
    if (query.action)
      builder.andWhere('log.action LIKE :action', {
        action: `%${query.action.trim()}%`,
      });
    if (query.actorType)
      builder.andWhere('log.actor_type = :actorType', {
        actorType: query.actorType,
      });
    if (query.result)
      builder.andWhere('log.result = :result', { result: query.result });
    if (query.from)
      builder.andWhere('log.created_at >= :from', {
        from: new Date(query.from),
      });
    if (query.to)
      builder.andWhere('log.created_at <= :to', {
        to: new Date(query.to),
      });
    const [records, total] = await builder
      .orderBy('log.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    const items = records.map((record) => ({
      ...record,
      ipAddress: this.maskIp(record.ipAddress),
      metadata: this.maskAuditMetadata(record.metadata),
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async listAiCallLogs(
    actor: JwtTeacherPayload,
    page: number,
    pageSize: number,
  ) {
    this.access.requireAdministrator(actor);
    const builder = this.aiCallLogs.createQueryBuilder('ai');
    if (actor.schoolId)
      builder.andWhere(
        `((ai.actor_type = 'teacher' AND ai.actor_id IN
          (SELECT id FROM teachers WHERE school_id = :aiSchoolId))
         OR (ai.actor_type = 'administrator' AND ai.actor_id IN
          (SELECT id FROM administrator WHERE school_id = :aiSchoolId)))`,
        { aiSchoolId: actor.schoolId },
      );
    const [items, total] = await builder
      .orderBy('ai.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async adminDashboard(actor: JwtTeacherPayload) {
    this.access.requireAdministrator(actor);
    const schoolId = actor.schoolId ?? null;
    const teachers = this.teachers.createQueryBuilder('teacher');
    const classes = this.classes.createQueryBuilder('class');
    const students = this.students
      .createQueryBuilder('student')
      .innerJoin(
        SchoolClass,
        'studentClass',
        'studentClass.id = student.class_id',
      );
    const devices = this.devices.createQueryBuilder('device');
    const runs = this.runs
      .createQueryBuilder('run')
      .innerJoin(SchoolClass, 'runClass', 'runClass.id = run.class_id');
    if (schoolId) {
      teachers.andWhere('teacher.school_id = :schoolId', { schoolId });
      classes.andWhere('class.school_id = :schoolId', { schoolId });
      students.andWhere('studentClass.school_id = :schoolId', { schoolId });
      devices.andWhere('device.school_id = :schoolId', { schoolId });
      runs.andWhere('runClass.school_id = :schoolId', { schoolId });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const allDevices = await devices.getMany();
    const heartbeatCutoff = Date.now() - this.heartbeatTimeoutMs;
    const onlineDevices = allDevices.filter(
      (device) =>
        device.status !== DeviceStatus.Disabled &&
        device.status !== DeviceStatus.Fault &&
        device.lastOnlineAt != null &&
        device.lastOnlineAt.getTime() >= heartbeatCutoff,
    ).length;
    const aiBuilder = this.aiCallLogs.createQueryBuilder('ai');
    if (schoolId)
      aiBuilder.andWhere(
        `((ai.actor_type = 'teacher' AND ai.actor_id IN
          (SELECT id FROM teachers WHERE school_id = :aiSchoolId))
         OR (ai.actor_type = 'administrator' AND ai.actor_id IN
          (SELECT id FROM administrator WHERE school_id = :aiSchoolId)))`,
        { aiSchoolId: schoolId },
      );
    const aiStats = await aiBuilder
      .select('COUNT(*)', 'total')
      .addSelect(
        "SUM(CASE WHEN ai.status = 'success' THEN 1 ELSE 0 END)",
        'success',
      )
      .addSelect(
        "SUM(CASE WHEN ai.status <> 'success' THEN 1 ELSE 0 END)",
        'error',
      )
      .addSelect('AVG(ai.latency_ms)', 'averageLatencyMs')
      .getRawOne<{
        total: number | string;
        success: number | string | null;
        error: number | string | null;
        averageLatencyMs: number | string | null;
      }>();
    const [
      teacherCount,
      classCount,
      studentCount,
      todayClassrooms,
      activeClassrooms,
      abnormalClassrooms,
      resourceStats,
      physicalStorage,
    ] = await Promise.all([
      teachers.getCount(),
      classes.getCount(),
      students.getCount(),
      runs
        .clone()
        .andWhere('run.created_at >= :today', { today })
        .getCount(),
      runs
        .clone()
        .andWhere("run.status IN ('prepared','running','paused')")
        .getCount(),
      runs.clone().andWhere("run.status = 'failed'").getCount(),
      this.resourceDashboardStats(schoolId),
      this.storageUsageBytes(),
    ]);
    const aiTotal = Number(aiStats?.total ?? 0);
    const aiSuccess = Number(aiStats?.success ?? 0);
    const aiErrors = Number(aiStats?.error ?? 0);
    return {
      generatedAt: new Date().toISOString(),
      teachers: teacherCount,
      classes: classCount,
      students: studentCount,
      devices: {
        total: allDevices.length,
        online: onlineDevices,
        offline: allDevices.length - onlineDevices,
      },
      classrooms: {
        today: todayClassrooms,
        active: activeClassrooms,
        abnormal: abnormalClassrooms,
      },
      resources: {
        pending: resourceStats.pending,
        disabled: resourceStats.disabled,
      },
      ai: {
        total: aiTotal,
        success: aiSuccess,
        errors: aiErrors,
        successRate: aiTotal
          ? Number(((aiSuccess / aiTotal) * 100).toFixed(2))
          : 0,
        errorRate: aiTotal
          ? Number(((aiErrors / aiTotal) * 100).toFixed(2))
          : 0,
        averageLatencyMs: Math.round(
          Number(aiStats?.averageLatencyMs ?? 0),
        ),
      },
      storage: {
        indexedResourceBytes: resourceStats.bytes,
        physicalBytes: physicalStorage,
      },
    };
  }

  private async resourceDashboardStats(
    schoolId: string | null,
  ): Promise<{ pending: number; disabled: number; bytes: number }> {
    const runner = this.dataSource.createQueryRunner();
    try {
      if (!(await runner.hasTable('teaching_resource')))
        return { pending: 0, disabled: 0, bytes: 0 };
      const schoolClause = schoolId ? ' AND school_id = ?' : '';
      const parameters = schoolId ? [schoolId] : [];
      const rows = (await runner.query(
        `SELECT
           SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN review_status = 'disabled' THEN 1 ELSE 0 END) AS disabled,
           COALESCE(SUM(file_size), 0) AS bytes
         FROM teaching_resource
         WHERE deleted_at IS NULL${schoolClause}`,
        parameters,
      )) as Array<{
        pending: number | string | null;
        disabled: number | string | null;
        bytes: number | string | null;
      }>;
      return {
        pending: Number(rows[0]?.pending ?? 0),
        disabled: Number(rows[0]?.disabled ?? 0),
        bytes: Number(rows[0]?.bytes ?? 0),
      };
    } finally {
      await runner.release();
    }
  }

  private maskIp(value: string | null): string | null {
    if (!value) return null;
    if (value.includes(':'))
      return `${value.split(':').slice(0, 2).join(':')}:***`;
    const parts = value.split('.');
    return parts.length === 4
      ? `${parts[0]}.${parts[1]}.*.*`
      : '***';
  }

  private maskAuditMetadata(
    value: string | null,
  ): Record<string, unknown> | null {
    if (!value) return null;
    try {
      return this.maskAuditValue(JSON.parse(value)) as Record<string, unknown>;
    } catch {
      return { value: '[无法解析的历史元数据]' };
    }
  }

  private maskAuditValue(value: unknown, key = ''): unknown {
    if (
      /password|token|secret|authorization|phone|address|rawAudio/i.test(key)
    )
      return '***';
    if (Array.isArray(value))
      return value.map((item) => this.maskAuditValue(item));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([entryKey, entryValue]) => [
            entryKey,
            this.maskAuditValue(entryValue, entryKey),
          ],
        ),
      );
    return value;
  }

  private async storageUsageBytes(): Promise<number> {
    const roots = [
      this.config.get<string>('DATABASE_PATH'),
      this.config.get<string>('RESOURCE_UPLOAD_ROOT_PATH') ??
        resolve(process.cwd(), 'uploads'),
    ].filter((path): path is string => Boolean(path));
    const sizeOf = async (path: string): Promise<number> => {
      const info = await stat(path).catch(() => null);
      if (!info) return 0;
      if (info.isFile()) return info.size;
      if (!info.isDirectory()) return 0;
      const entries = await readdir(path).catch(() => [] as string[]);
      const sizes = await Promise.all(
        entries.map((entry) => sizeOf(resolve(path, entry))),
      );
      return sizes.reduce((sum, size) => sum + size, 0);
    };
    const sizes = await Promise.all(
      roots.map((root) => sizeOf(resolve(root))),
    );
    return sizes.reduce((sum, size) => sum + size, 0);
  }

  private async deviceSummaries(devices: Device[]) {
    if (!devices.length) return [];
    const bindings = await this.bindings.find({
      where: {
        deviceId: In(devices.map((device) => device.id)),
        status: BindingStatus.Active,
      },
    });
    const [classrooms, classes] = await Promise.all([
      bindings.length
        ? this.classrooms.find({
            where: { id: In(bindings.map((binding) => binding.classroomId)) },
          })
        : Promise.resolve([]),
      bindings.length
        ? this.classes.find({
            where: { id: In(bindings.map((binding) => binding.classId)) },
          })
        : Promise.resolve([]),
    ]);
    const bindingByDevice = new Map(
      bindings.map((binding) => [binding.deviceId, binding]),
    );
    const classroomById = new Map(classrooms.map((item) => [item.id, item]));
    const classById = new Map(classes.map((item) => [item.id, item]));
    return devices.map((device) => {
      const binding = bindingByDevice.get(device.id);
      return {
        ...this.deviceStatusSummary(device),
        binding: binding
          ? {
              id: binding.id,
              classroomId: binding.classroomId,
              classroomName:
                classroomById.get(binding.classroomId)?.name ?? null,
              classId: binding.classId,
              className: classById.get(binding.classId)?.name ?? null,
              boundAt: binding.boundAt,
            }
          : null,
      };
    });
  }

  private deviceStatusSummary(device: Device) {
    const heartbeatFresh =
      device.lastOnlineAt != null &&
      Date.now() - device.lastOnlineAt.getTime() <= this.heartbeatTimeoutMs;
    const status = [DeviceStatus.Disabled, DeviceStatus.Fault].includes(
      device.status,
    )
      ? device.status
      : heartbeatFresh
        ? DeviceStatus.Online
        : DeviceStatus.Offline;
    return { ...device, status, online: status === DeviceStatus.Online };
  }

  private studentSummary(student: Student) {
    return {
      id: student.id,
      classId: student.classId,
      studentNo: student.studentNo,
      name: student.name,
      nickname: student.nickname,
      status: student.status,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    };
  }

  private requireSameSchool(
    actor: JwtTeacherPayload,
    schoolId: string | null,
  ): void {
    if (actor.schoolId && schoolId && actor.schoolId !== schoolId)
      throw new ConflictException('数据不属于当前园所');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
