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
@Index('IDX_student_question_student', ['studentId'])
@Index('IDX_student_question_class', ['classId'])
@Index('IDX_student_question_run', ['classroomRunId'])
@Index('IDX_student_question_topic', ['topic'])
@Index('IDX_student_question_domain', ['domain'])
@Index('IDX_student_question_teacher', ['teacherId'])
export class StudentQuestionRecord {
  @Column({ name: 'answer_text', type: 'text', nullable: true }) answerText: string | null;
  @Column({ name: 'answer_status', type: 'varchar', length: 30, nullable: true }) answerStatus: string | null;
  @Column({ name: 'answer_source', type: 'varchar', length: 100, nullable: true }) answerSource: string | null;
  @Column({ name: 'qa_session_id', type: 'varchar', length: 100, nullable: true }) qaSessionId: string | null;
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'student_id', type: 'integer', nullable: true }) studentId: number | null;
  @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'classroom_run_id', type: 'integer' }) classroomRunId: number;
  @Column({ name: 'lesson_step_index', type: 'integer', nullable: true }) lessonStepIndex: number | null;
  @Column({ name: 'asr_raw_text', type: 'text' }) asrRawText: string;
  @Column({ name: 'teacher_corrected_text', type: 'text', nullable: true }) teacherCorrectedText: string | null;
  @Column({ name: 'question_text', type: 'text' }) questionText: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) topic: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) domain: string | null;
  @Column({ name: 'is_anonymous', type: 'boolean', default: false }) isAnonymous: boolean;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 }) requestId: string;
  @Column({ name: 'request_hash', type: 'varchar', length: 64 }) requestHash: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
