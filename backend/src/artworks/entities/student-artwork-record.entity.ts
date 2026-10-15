import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'student_artwork_record' })
export class StudentArtworkRecord {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'student_id', type: 'integer', nullable: true }) studentId: number | null;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index() @Column({ name: 'classroom_run_id', type: 'integer' }) classroomRunId: number;
  @Column({ name: 'lesson_step_index', type: 'integer', nullable: true }) lessonStepIndex: number | null;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'storage_key', type: 'varchar', length: 255 }) storageKey: string;
  @Column({ name: 'mime_type', type: 'varchar', length: 64 }) mimeType: string;
  @Column({ name: 'original_name', type: 'varchar', length: 255 }) originalName: string;
  @Column({ name: 'ai_draft', type: 'text', nullable: true }) aiDraft: string | null;
  @Column({ name: 'teacher_comment', type: 'text', nullable: true }) teacherComment: string | null;
  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true }) confirmedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
