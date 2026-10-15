export enum AttendanceStatus {
  Present = 'present',
  Absent = 'absent',
  Late = 'late',
  Leave = 'leave',
}

export enum AttendanceChangeSource {
  Manual = 'manual',
  Batch = 'batch',
  VoiceConfirmed = 'voice_confirmed',
}

export enum RollCallMode {
  All = 'all',
  Range = 'range',
  Group = 'group',
  TeacherSpecified = 'teacher_specified',
}

export const ROLL_CALL_ALGORITHM_VERSION = 'fair-v1';
