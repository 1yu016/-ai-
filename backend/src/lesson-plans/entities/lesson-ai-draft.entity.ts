import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LessonAiDraftStatus } from '../lesson-plan.types';

@Entity({ name: 'lesson_ai_draft' })
export class LessonAiDraft {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'teacher_id', type: 'integer' })
  teacherId: number;
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({ name: 'input_json', type: 'text' }) inputJson: string;
  @Column({ name: 'output_json', type: 'text', nullable: true })
  outputJson: string | null;
  @Column({ type: 'varchar', length: 100 }) provider: string;
  @Column({ type: 'varchar', length: 100 }) model: string;
  @Column({ type: 'simple-enum', enum: LessonAiDraftStatus })
  status: LessonAiDraftStatus;
  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs: number | null;
  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens: number | null;
  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens: number | null;
  @Column({ name: 'total_tokens', type: 'integer', nullable: true })
  totalTokens: number | null;
  @Column({
    name: 'error_message',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  errorMessage: string | null;
  @Column({ name: 'confirmed_by', type: 'integer', nullable: true })
  confirmedBy: number | null;
  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;
  @Column({ name: 'lesson_plan_id', type: 'integer', nullable: true })
  lessonPlanId: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
