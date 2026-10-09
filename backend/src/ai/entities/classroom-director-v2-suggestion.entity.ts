import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ClassroomDirectorV2SuggestionType } from '../dto/classroom-director-v2.dto';

export enum DirectorSuggestionStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Rejected = 'rejected',
}

@Entity({ name: 'classroom_director_suggestion_v2' })
export class ClassroomDirectorV2Suggestion {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'classroom_run_id', type: 'integer' }) classroomRunId: number;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ type: 'simple-enum', enum: ClassroomDirectorV2SuggestionType }) type: ClassroomDirectorV2SuggestionType;
  @Column({ type: 'varchar', length: 100 }) title: string;
  @Column({ name: 'original_content', type: 'text' }) originalContent: string;
  @Column({ name: 'current_content', type: 'text' }) currentContent: string;
  @Column({ type: 'text' }) rationale: string;
  @Column({ name: 'resource_id', type: 'integer', nullable: true }) resourceId: number | null;
  @Column({ name: 'command_operation', type: 'varchar', length: 50, nullable: true }) commandOperation: string | null;
  @Column({ name: 'command_parameters', type: 'text', nullable: true }) commandParameters: string | null;
  @Column({ type: 'simple-enum', enum: DirectorSuggestionStatus, default: DirectorSuggestionStatus.Pending }) status: DirectorSuggestionStatus;
  @Column({ name: 'confirmed_request_id', type: 'varchar', length: 100, nullable: true }) confirmedRequestId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
