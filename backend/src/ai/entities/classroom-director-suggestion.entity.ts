import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ClassroomDirectorDecision,
  ClassroomDirectorSuggestionStatus,
  ClassroomDirectorSuggestionType,
} from '../dto/classroom-director.dto';

@Entity({ name: 'classroom_director_suggestion' })
@Index(['teacherId', 'requestId'], { unique: true })
export class ClassroomDirectorSuggestion {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;
  @Column({ name: 'run_version', type: 'integer' }) runVersion: number;
  @Column({ name: 'current_step_index', type: 'integer' })
  currentStepIndex: number;
  @Column({
    type: 'simple-enum',
    enum: ClassroomDirectorSuggestionStatus,
    default: ClassroomDirectorSuggestionStatus.Processing,
  })
  status: ClassroomDirectorSuggestionStatus;
  @Column({
    name: 'suggestion_type',
    type: 'simple-enum',
    enum: ClassroomDirectorSuggestionType,
    nullable: true,
  })
  suggestionType: ClassroomDirectorSuggestionType | null;
  @Column({ name: 'teacher_message', type: 'text', nullable: true })
  teacherMessage: string | null;
  @Column({ type: 'text', nullable: true }) reason: string | null;
  @Column({ name: 'suggested_action', type: 'text', nullable: true })
  suggestedAction: string | null;
  @Column({ name: 'resource_candidates', type: 'text', default: '[]' })
  resourceCandidates: string;
  @Column({ type: 'real', nullable: true }) confidence: number | null;
  @Column({ name: 'requires_confirmation', type: 'boolean', default: true })
  requiresConfirmation: boolean;
  @Column({ type: 'varchar', length: 100, nullable: true }) provider:
    string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) model:
    string | null;
  @Column({ name: 'input_summary', type: 'text' }) inputSummary: string;
  @Column({ name: 'output_json', type: 'text', nullable: true }) outputJson:
    string | null;
  @Column({ name: 'latency_ms', type: 'integer', nullable: true }) latencyMs:
    number | null;
  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens: number | null;
  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens: number | null;
  @Column({ name: 'total_tokens', type: 'integer', nullable: true })
  totalTokens: number | null;
  @Column({
    type: 'simple-enum',
    enum: ClassroomDirectorDecision,
    nullable: true,
  })
  decision: ClassroomDirectorDecision | null;
  @Column({ name: 'edited_teacher_message', type: 'text', nullable: true })
  editedTeacherMessage: string | null;
  @Column({ name: 'edited_suggested_action', type: 'text', nullable: true })
  editedSuggestedAction: string | null;
  @Column({ type: 'boolean', nullable: true }) executed: boolean | null;
  @Column({
    name: 'execution_result',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  executionResult: string | null;
  @Column({ name: 'decided_at', type: 'datetime', nullable: true })
  decidedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
