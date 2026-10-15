import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  HeuristicDraftStatus,
  HeuristicFollowUpType,
  HeuristicSafetyStatus,
} from '../dto/heuristic-assistant.dto';

@Entity({ name: 'heuristic_assistant_draft' })
@Index(['teacherId', 'requestId'], { unique: true })
export class HeuristicAssistantDraft {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;

  @Index()
  @Column({ name: 'teacher_id', type: 'integer' })
  teacherId: number;

  @Column({ name: 'request_id', type: 'varchar', length: 100 })
  requestId: string;

  @Column({ name: 'run_version', type: 'integer' })
  runVersion: number;

  @Column({ name: 'current_step_index', type: 'integer' })
  currentStepIndex: number;

  @Column({ name: 'attempt_count', type: 'integer' })
  attemptCount: number;

  @Column({ name: 'input_summary', type: 'text' })
  inputSummary: string;

  @Column({ name: 'response_text', type: 'text', nullable: true })
  responseText: string | null;

  @Column({ name: 'hint_level', type: 'integer', nullable: true })
  hintLevel: number | null;

  @Column({
    name: 'safety_status',
    type: 'simple-enum',
    enum: HeuristicSafetyStatus,
    nullable: true,
  })
  safetyStatus: HeuristicSafetyStatus | null;

  @Column({
    name: 'follow_up_type',
    type: 'simple-enum',
    enum: HeuristicFollowUpType,
    nullable: true,
  })
  followUpType: HeuristicFollowUpType | null;

  @Column({ name: 'recommended_resource_id', type: 'integer', nullable: true })
  recommendedResourceId: number | null;

  @Column({
    name: 'requires_teacher_confirmation',
    type: 'boolean',
    default: true,
  })
  requiresTeacherConfirmation: boolean;

  @Column({
    type: 'simple-enum',
    enum: HeuristicDraftStatus,
    default: HeuristicDraftStatus.Processing,
  })
  status: HeuristicDraftStatus;

  @Column({ name: 'edited_response_text', type: 'text', nullable: true })
  editedResponseText: string | null;

  @Column({ name: 'decided_at', type: 'datetime', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'tts_played_at', type: 'datetime', nullable: true })
  ttsPlayedAt: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs: number | null;

  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens: number | null;

  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens: number | null;

  @Column({ name: 'total_tokens', type: 'integer', nullable: true })
  totalTokens: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
