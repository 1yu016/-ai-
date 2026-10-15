import { BadgeDefinition } from './badge-definition.entity';
import { BreakConfig } from './break-config.entity';
import { BreakRun } from './break-run.entity';
import { ClassGrowthRecord } from './class-growth-record.entity';
import { CollectiveGoal } from './collective-goal.entity';
import { HonorRecord } from './honor-record.entity';
import { RewardRecord } from './reward-record.entity';
import { RewardReversal } from './reward-reversal.entity';
import { RewardRule } from './reward-rule.entity';
import { StudentBadge } from './student-badge.entity';

export const CLASSROOM_ENGAGEMENT_ENTITIES = [
  RewardRule,
  RewardRecord,
  RewardReversal,
  BadgeDefinition,
  StudentBadge,
  ClassGrowthRecord,
  HonorRecord,
  CollectiveGoal,
  BreakConfig,
  BreakRun,
];

export {
  RewardRule,
  RewardRecord,
  RewardReversal,
  BadgeDefinition,
  StudentBadge,
  ClassGrowthRecord,
  HonorRecord,
  CollectiveGoal,
  BreakConfig,
  BreakRun,
};
