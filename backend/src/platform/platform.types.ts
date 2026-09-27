export enum RecordStatus {
  Active = 'active',
  Disabled = 'disabled',
}

export enum TeacherClassRole {
  Lead = 'lead',
  Assistant = 'assistant',
  Observer = 'observer',
}

export enum DeviceType {
  ClassroomScreen = 'classroom_screen',
  TeacherTablet = 'teacher_tablet',
  TeacherPhone = 'teacher_phone',
  Other = 'other',
}

export enum DeviceStatus {
  Online = 'online',
  Offline = 'offline',
  Disabled = 'disabled',
  Fault = 'fault',
}

export enum BindingStatus {
  Active = 'active',
  Unbound = 'unbound',
}

export enum ConsentType {
  Photo = 'photo',
  Voice = 'voice',
  Artwork = 'artwork',
}

export enum ConsentStatus {
  Granted = 'granted',
  Revoked = 'revoked',
  Pending = 'pending',
}

export enum AuditResult {
  Success = 'success',
  Failure = 'failure',
}
