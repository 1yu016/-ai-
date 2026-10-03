export enum AvatarCategory {
  TeacherAssistant = 'teacher_assistant',
  CartoonAnimal = 'cartoon_animal',
  KindergartenCustom = 'kindergarten_custom',
}

export enum AvatarCharacterStatus {
  Draft = 'draft',
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Disabled = 'disabled',
}

export enum AvatarVersionStatus {
  Draft = 'draft',
  Ready = 'ready',
  Disabled = 'disabled',
}

export enum AvatarModelFormat {
  Glb = 'glb',
  Gltf = 'gltf',
  Vrm = 'vrm',
}

export enum AvatarAssetType {
  Model = 'model',
  Texture = 'texture',
  Animation = 'animation',
  Expression = 'expression',
  LipSync = 'lip_sync',
  Preview = 'preview',
  Fallback2d = 'fallback_2d',
}

export enum AvatarActionName {
  Idle = 'idle',
  Listen = 'listen',
  Think = 'think',
  Speak = 'speak',
  Question = 'question',
  Happy = 'happy',
  Encourage = 'encourage',
  Wave = 'wave',
  Goodbye = 'goodbye',
}

export enum AvatarVoiceStatus {
  Active = 'active',
  Disabled = 'disabled',
  Unavailable = 'unavailable',
}

export enum AvatarBindingScope {
  System = 'system',
  Class = 'class',
  LessonPlan = 'lesson_plan',
  ClassroomRun = 'classroom_run',
}

export enum AvatarBindingStatus {
  Active = 'active',
  Cancelled = 'cancelled',
}

export enum AvatarFallbackLevel {
  None = 'none',
  Action = 'action',
  Voice = 'voice',
  Model2d = 'model_2d',
  SystemCharacter = 'system_character',
  SafeMode = 'safe_mode',
}

export const REQUIRED_AVATAR_ACTIONS = [
  AvatarActionName.Idle,
  AvatarActionName.Speak,
] as const;

export type AvatarIntegrityIssue = {
  code: string;
  message: string;
};
