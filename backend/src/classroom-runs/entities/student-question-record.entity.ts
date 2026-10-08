import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'student_question_record' })
@Unique('UQ_student_question_run_request', ['classroomRunId', 'requestId'])
@Index('IDX_student_question_class_created', ['classId', 'createdAt'])
@Index('IDX_student_question_student_created', ['classId', 'studentId', 'createdAt'])
export class StudentQuestionRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'student_id', type: 'integer', nullable: true }) studentId: number | null;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index() @Column({ name: 'classroom_run_id', type: 'integer' }) classroomRunId: number;
  @Column({ name: 'lesson_step_index', type: 'integer', nullable: true }) lessonStepIndex: number | null;
  @Column({ name: 'asr_raw_text', type: 'text' }) asrRawText: string;
  @Column({ name: 'teacher_corrected_text', type: 'text', nullable: true }) teacherCorrectedText: string | null;
  @Column({ name: 'question_text', type: 'text' }) questionText: string;
  @Index() @Column({ type: 'varchar', length: 100, nullable: true }) topic: string | null;
  @Index() @Column({ type: 'varchar', length: 100, nullable: true }) domain: string | null;
  @Column({ name: 'is_anonymous', type: 'boolean', default: false }) isAnonymous: boolean;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 }) requestId: string;
  @Column({ name: 'request_hash', type: 'varchar', length: 64 }) requestHash: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
