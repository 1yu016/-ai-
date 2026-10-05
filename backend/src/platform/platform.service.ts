import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { Teacher } from '../auth/entities/teacher.entity';
import {
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
import { BindingStatus, ConsentStatus, RecordStatus } from './platform.types';

@Injectable()
export class PlatformService {
  constructor(
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
      .select('COALESCE(SUM(r.stars), 0)', 'totalStars')
      .where('r.class_id = :classId', { classId })
      .getRawOne<{ totalStars: number | string }>()) ?? { totalStars: 0 };
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
        stars: r.stars,
        reason: r.reason,
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
    if (this.access.isAdministrator(actor))
      return this.devices.find({
        where: actor.schoolId ? { schoolId: actor.schoolId } : {},
        order: { id: 'DESC' },
      });
    return this.devices
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
      return {
        id: b.id,
        classId: b.classId,
        classroomId: b.classroomId,
        classroom: classroom ? { id: classroom.id, name: classroom.name } : null,
        deviceId: b.deviceId,
        device: device
          ? {
              id: device.id,
              name: device.name,
              type: device.type,
              status: device.status,
            }
          : null,
      };
    });
  }

  async createTicket(actor: JwtTeacherPayload, dto: CreateTicketDto) {
    await this.access.requireClassAccess(actor, dto.classId);
    const binding = await this.bindings.findOne({
      where: {
        deviceId: dto.deviceId,
        classroomId: dto.classroomId,
        classId: dto.classId,
        status: BindingStatus.Active,
      },
    });
    if (!binding) throw new ConflictException('设备、教室与班级不存在有效绑定');
    const ticket = randomBytes(32).toString('base64url');
    const entity = await this.tickets.save(
      this.tickets.create({
        ticketHash: this.hash(ticket),
        deviceId: dto.deviceId,
        classroomId: dto.classroomId,
        classId: dto.classId,
        lessonRunId: dto.lessonRunId ?? null,
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
    return { ticket, expiresAt: entity.expiresAt };
  }

  async consumeTicket(ticket: string, deviceCode: string) {
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
    page: number,
    pageSize: number,
  ) {
    this.access.requireAdministrator(actor);
    const [items, total] = await this.auditLogs.findAndCount({
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async listAiCallLogs(
    actor: JwtTeacherPayload,
    page: number,
    pageSize: number,
  ) {
    this.access.requireAdministrator(actor);
    const [items, total] = await this.aiCallLogs.findAndCount({
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
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
