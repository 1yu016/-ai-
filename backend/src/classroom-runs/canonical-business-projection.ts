import type { EntityManager } from 'typeorm';
import { StudentRewardRecord } from './entities/student-reward-record.entity';
import { StudentAttendanceRecord } from './entities/student-attendance-record.entity';
import { ClassroomRollCallRecord, RollCallMode } from './entities/classroom-roll-call-record.entity';
import { Student } from '../platform/entities/student.entity';

export type BusinessDomain = 'reward' | 'attendance' | 'roll_call';
export async function readBusinessProjection(manager: EntityManager, runId: number, domain: BusinessDomain) {
  if (domain === 'reward') {
    const rows = await manager.getRepository(StudentRewardRecord).find({ where: { classroomRunId: runId }, order: { id: 'ASC' } });
    const rewardState: Record<string, number> = {};
    for (const r of rows) rewardState[r.studentId] = (rewardState[r.studentId] ?? 0) + (r.revokedAt ? 0 : r.stars);
    return { rewardState };
  }
  if (domain === 'attendance') {
    const rows = await manager.getRepository(StudentAttendanceRecord).find({ where: { classroomRunId: runId }, order: { studentId: 'ASC' } });
    return { attendanceState: Object.fromEntries(rows.map(r => [r.studentId, r.status])) };
  }
  if (domain !== 'roll_call') throw new Error('Unknown canonical projection domain');
  const rows = await manager.getRepository(ClassroomRollCallRecord).find({
    where: { classroomRunId: runId }, order: { createdAt: 'DESC', id: 'DESC' },
  });
  if (!rows.length) return { rollCallState: {} };
  const counts: Record<number, number> = {};
  for (const row of rows) counts[row.studentId] = (counts[row.studentId] ?? 0) + 1;
  const latest = rows[0]!;
  const student = await manager.getRepository(Student).findOneBy({ id: latest.studentId });
  const lastOperation = { [RollCallMode.Random]: 'random_roll_call', [RollCallMode.Specified]: 'specified_roll_call',
    [RollCallMode.GroupRandom]: 'group_roll_call' }[latest.mode];
  return { rollCallState: { counts, recentStudentIds: [...new Set(rows.map(r => r.studentId))].slice(0, 5),
    recentResults: rows.slice(0, 5).map(r => ({ recordId: r.id, studentId: r.studentId, mode: r.mode })),
    lastRecordId: latest.id, lastStudentId: latest.studentId, lastStudentDisplayName: student?.nickname || student?.name || '',
    lastOperation, updatedAt: latest.createdAt.toISOString() } };
}
