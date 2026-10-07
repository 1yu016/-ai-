import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ClassroomSummaryDraftStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Discarded = 'discarded',
}

export enum ClassroomSummaryDraftSource {
  Ai = 'ai',
  SafeRules = 'safe_rules',
}

@Entity({ name: 'classroom_summary_draft' })
@Index('UQ_classroom_summary_draft_run', ['classroomRunId'], { unique: true })
export class ClassroomSummaryDraft {
  @PrimaryGeneratedColumn() id: number;

  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;

  @Column({ name: 'teacher_id', type: 'integer' })
  teacherId: number;

  @Column({ name: 'classroom_summary', type: 'text' })
  classroomSummary: string;

  @Column({ type: 'text' }) participation: string;

  @Column({ name: 'interest_points', type: 'text', default: '[]' })
  interestPoints: string;

  @Column({ name: 'common_questions', type: 'text', default: '[]' })
  commonQuestions: string;

  @Column({ name: 'teaching_strategies', type: 'text', default: '[]' })
  teachingStrategies: string;

  @Column({ type: 'simple-enum', enum: ClassroomSummaryDraftSource })
  source: ClassroomSummaryDraftSource;

  @Column({
    type: 'simple-enum',
    enum: ClassroomSummaryDraftStatus,
    default: ClassroomSummaryDraftStatus.Pending,
  })
  status: ClassroomSummaryDraftStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
