import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RewardCategory } from '../reward-system.types';

/**
 * 幼儿成长奖励长期流水（Stage 7.3）。
 * 每次独立奖励一行；与 classroom_snapshot.rewardState（课堂快速恢复的累计状态）职责分离。
 * (classroom_run_id, request_id) 唯一：双击 / 网络重试 / 离线队列重发时保证幂等。
 */
@Entity({ name: 'student_reward_record' })
@Index('UQ_student_reward_record_run_request', ['classroomRunId', 'requestId'], {
  unique: true,
})
// 班级奖励历史查询（WHERE class_id 或 class_id + student_id，ORDER BY created_at DESC, id DESC）的最小复合索引。
@Index('IDX_student_reward_record_class_created', ['classId', 'createdAt'])
@Index('IDX_student_reward_record_class_student_created', [
  'classId',
  'studentId',
  'createdAt',
])
export class StudentRewardRecord {
  @PrimaryGeneratedColumn() id: number;

  @Index()
  @Column({ name: 'student_id', type: 'integer' })
  studentId: number;

  @Index()
  @Column({ name: 'class_id', type: 'integer' })
  classId: number;

  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;

  @Index()
  @Column({ name: 'teacher_id', type: 'integer' })
  teacherId: number;

  @Column({ name: 'reward_type', type: 'varchar', length: 32, default: 'flower' })
  rewardType: string;

  @Column({ name: 'reward_category', type: 'simple-enum', enum: RewardCategory, default: RewardCategory.Progress })
  rewardCategory: RewardCategory;

  @Column({ name: 'reward_forms', type: 'text', default: '["flower"]' })
  rewardForms: string;

  @Column({ name: 'points', type: 'integer', default: 1 })
  points: number;

  @Column({ name: 'badge_code', type: 'varchar', length: 64, nullable: true })
  badgeCode: string | null;

  @Column({ name: 'praise_template_id', type: 'varchar', length: 64, nullable: true })
  praiseTemplateId: string | null;

  @Column({ name: 'praise_text', type: 'varchar', length: 120, nullable: true })
  praiseText: string | null;

  @Column({ name: 'teacher_confirmed_praise', type: 'boolean', default: false })
  teacherConfirmedPraise: boolean;

  @Column({ name: 'animation_key', type: 'varchar', length: 32, nullable: true })
  animationKey: string | null;

  @Column({ name: 'stars', type: 'integer', default: 1 })
  stars: number;

  @Column({ name: 'reason', type: 'varchar', length: 200, nullable: true })
  reason: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;

  @Index({ unique: true })
  @Column({ name: 'revoke_request_id', type: 'varchar', length: 100, nullable: true })
  revokeRequestId: string | null;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_by_teacher_id', type: 'integer', nullable: true })
  revokedByTeacherId: number | null;

  @Column({ name: 'revoke_reason', type: 'varchar', length: 200, nullable: true })
  revokeReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
