import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';

@Entity({ name: 'lesson_plan_version' })
@Index(['lessonPlanId', 'versionNo'], { unique: true })
export class LessonPlanVersion {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'lesson_plan_id', type: 'integer' })
  lessonPlanId: number;
  @Column({ name: 'version_no', type: 'integer' }) versionNo: number;
  @Column({ name: 'snapshot_json', type: 'text' }) snapshotJson: string;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @Column({ name: 'created_by_type', type: 'simple-enum', enum: AuthUserType })
  createdByType: AuthUserType;
  @Column({ name: 'change_summary', type: 'varchar', length: 500 })
  changeSummary: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
