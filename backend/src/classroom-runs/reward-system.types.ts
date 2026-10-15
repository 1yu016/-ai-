export enum RewardCategory {
  Answer = 'answer',
  Cooperation = 'cooperation',
  Focus = 'focus',
  Labor = 'labor',
  Exploration = 'exploration',
  Progress = 'progress',
}

export enum RewardForm {
  Points = 'points',
  Badge = 'badge',
  Flower = 'flower',
  VoicePraise = 'voice_praise',
  Animation = 'animation',
}

export enum GrowthGoalStatus {
  Active = 'active',
  Completed = 'completed',
  Archived = 'archived',
}

export const SAFE_PRAISE_TEMPLATES: Record<string, string> = {
  warm_answer: '你认真思考的样子真棒！',
  kind_cooperation: '谢谢你和小伙伴一起合作！',
  careful_focus: '你刚才观察得很仔细！',
  brave_explore: '你愿意大胆尝试，真有探索精神！',
  steady_progress: '老师看见了你的进步，继续加油！',
  happy_labor: '谢谢你主动劳动，让我们的班级更美好！',
};

export const SAFE_REWARD_ANIMATIONS = [
  'stars',
  'flowers',
  'rainbow',
  'confetti',
] as const;
