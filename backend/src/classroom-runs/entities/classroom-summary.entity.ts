import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'classroom_summary' })
@Index('UQ_classroom_summary_run', ['classroomRunId'], { unique: true })
export class ClassroomSummary {
  @PrimaryGeneratedColumn() id: number;

  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;

  @Column({ name: 'draft_id', type: 'integer' })
  draftId: number;

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

  @Column({ name: 'confirmed_at', type: 'datetime' })
  confirmedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
