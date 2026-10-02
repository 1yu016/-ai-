import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

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

  @Column({ name: 'stars', type: 'integer', default: 1 })
  stars: number;

  @Column({ name: 'reason', type: 'varchar', length: 200, nullable: true })
  reason: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
