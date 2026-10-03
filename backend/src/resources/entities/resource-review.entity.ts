import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ResourceReviewStatus } from '../../data/entities/teaching-resource.entity';

@Entity({ name: 'resource_review' })
export class ResourceReview {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'resource_id', type: 'integer' }) resourceId: number;
  @Column({ name: 'reviewer_id', type: 'integer' }) reviewerId: number;
  @Column({ type: 'simple-enum', enum: ResourceReviewStatus })
  status: ResourceReviewStatus;
  @Column({ type: 'varchar', length: 1000, nullable: true }) comment:
    string | null;
  @Column({ name: 'reviewed_at', type: 'datetime' }) reviewedAt: Date;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
