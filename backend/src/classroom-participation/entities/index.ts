import { AttendanceChangeLog } from './attendance-change-log.entity';
import { AttendanceRecord } from './attendance-record.entity';
import { RollCallCandidateSnapshot } from './roll-call-candidate-snapshot.entity';
import { RollCallRecord } from './roll-call-record.entity';
import { StudentGroupMember } from './student-group-member.entity';
import { StudentGroup } from './student-group.entity';

export const CLASSROOM_PARTICIPATION_ENTITIES = [
  AttendanceRecord,
  AttendanceChangeLog,
  StudentGroup,
  StudentGroupMember,
  RollCallRecord,
  RollCallCandidateSnapshot,
];

export {
  AttendanceRecord,
  AttendanceChangeLog,
  StudentGroup,
  StudentGroupMember,
  RollCallRecord,
  RollCallCandidateSnapshot,
};
