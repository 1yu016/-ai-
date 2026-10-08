import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { Student } from '../platform/entities/student.entity';
import { RecordStatus } from '../platform/platform.types';
import { ClassroomRunService } from './classroom-run.service';
import {
  AttendanceChangeSource,
  StudentAttendanceChange,
} from './entities/student-attendance-change.entity';
import {
  AttendanceStatus,
  StudentAttendanceRecord,
} from './entities/student-attendance-record.entity';

export type AttendanceUpdate = { studentId: number; status: AttendanceStatus };

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(StudentAttendanceRecord)
    private readonly records: Repository<StudentAttendanceRecord>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
    private readonly dataSource: DataSource,
    private readonly runs: ClassroomRunService,
  ) {}

  async list(actor: JwtTeacherPayload, runId: number) {
    const run = await this.runs.get(actor, runId);
    const items = await this.records.find({
      where: { classroomRunId: runId },
      order: { studentId: 'ASC' },
    });
    return { runId, classId: run.classId, items, attendanceState: this.state(items) };
  }

  async apply(
    actor: JwtTeacherPayload,
    run: { id: number; classId: number },
    requestId: string,
    updates: AttendanceUpdate[],
    source: AttendanceChangeSource,
  ) {
    if (!updates.length) throw new BadRequestException('至少提供一条考勤记录');
    const unique = new Map(updates.map((item) => [item.studentId, item]));
    const studentIds = [...unique.keys()];
    const students = await this.students.find({
      where: { id: In(studentIds), classId: run.classId, status: RecordStatus.Active },
    });
    if (students.length !== studentIds.length)
      throw new BadRequestException('考勤名单包含非本课堂或已停用幼儿');
    await this.dataSource.transaction(async (manager) => {
      const recordRepo = manager.getRepository(StudentAttendanceRecord);
      const changeRepo = manager.getRepository(StudentAttendanceChange);
      for (const item of unique.values()) {
        const previous = await recordRepo.findOne({
          where: { classroomRunId: run.id, studentId: item.studentId },
        });
        const previousStatus = previous?.status ?? null;
        const now = new Date();
        const record = previous
          ? Object.assign(previous, {
              status: item.status,
              modifiedByTeacherId: actor.sub,
              modifiedAt: now,
            })
          : recordRepo.create({
              classroomRunId: run.id,
              classId: run.classId,
              studentId: item.studentId,
              status: item.status,
              firstStatus: item.status,
              firstMarkedByTeacherId: actor.sub,
              firstMarkedAt: now,
              modifiedByTeacherId: actor.sub,
              modifiedAt: now,
            });
        const saved = await recordRepo.save(record);
        await changeRepo.save(changeRepo.create({
          attendanceRecordId: saved.id,
          classroomRunId: run.id,
          classId: run.classId,
          studentId: item.studentId,
          previousStatus,
          nextStatus: item.status,
          changedByTeacherId: actor.sub,
          source,
          requestId,
        }));
      }
    });
    const items = await this.records.find({ where: { classroomRunId: run.id } });
    return { items, attendanceState: this.state(items) };
  }

  async voiceCandidates(actor: JwtTeacherPayload, runId: number, transcript: string) {
    const run = await this.runs.get(actor, runId);
    const students = await this.students.find({
      where: { classId: run.classId, status: RecordStatus.Active },
      order: { id: 'ASC' },
    });
    const text = transcript.trim();
    const candidates = students.flatMap((student) => {
      const names = [student.name, student.nickname].filter(Boolean) as string[];
      if (!names.some((name) => text.includes(name))) return [];
      const status = this.detectStatus(text, names);
      return [{ studentId: student.id, displayName: student.nickname || student.name, status, confidence: status ? 0.9 : 0.6 }];
    });
    return { transcript: text, candidates, requiresTeacherConfirmation: true };
  }

  async excludedStudentIds(runId: number) {
    const items = await this.records.find({ where: { classroomRunId: runId } });
    return new Set(
      items
        .filter((item) => [AttendanceStatus.Absent, AttendanceStatus.Leave].includes(item.status))
        .map((item) => item.studentId),
    );
  }

  private state(items: StudentAttendanceRecord[]) {
    return Object.fromEntries(items.map((item) => [item.studentId, item.status]));
  }

  private detectStatus(text: string, names: string[]): AttendanceStatus | null {
    const position = Math.max(...names.map((name) => text.indexOf(name)));
    const nearby = text.slice(Math.max(0, position - 8), position + 20);
    if (/请假|休假/.test(nearby)) return AttendanceStatus.Leave;
    if (/缺勤|没来|未到|不到/.test(nearby)) return AttendanceStatus.Absent;
    if (/迟到/.test(nearby)) return AttendanceStatus.Late;
    if (/到课|到了|出勤|在/.test(nearby)) return AttendanceStatus.Present;
    return null;
  }
}
