import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OwnedEntity } from './owned.entity';

export enum ResourceType {
  Image = 'image',
  Audio = 'audio',
  Video = 'video',
  Document = 'document',
}

export enum ResourceAgeGroup {
  Small = 'small',
  Middle = 'middle',
  Large = 'large',
  All = 'all',
}

export enum ResourceReviewStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

@Entity({ name: 'teaching_resource' })
export class TeachingResource extends OwnedEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', default: '[]' })
  aliases: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'resource_type',
    type: 'simple-enum',
    enum: ResourceType,
    default: ResourceType.Document,
  })
  resourceType: ResourceType;

  @Column({ type: 'varchar', length: 100, default: '未分类' })
  category: string;

  @Column({
    name: 'age_group',
    type: 'simple-enum',
    enum: ResourceAgeGroup,
    default: ResourceAgeGroup.All,
  })
  ageGroup: ResourceAgeGroup;

  @Column({ type: 'text', default: '[]' })
  tags: string;

  @Column({ name: 'file_url', type: 'varchar', length: 500, default: '' })
  fileUrl: string;

  @Column({ name: 'cover_url', type: 'varchar', length: 500, nullable: true })
  coverUrl: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, default: '' })
  fileName: string;

  @Column({
    name: 'mime_type',
    type: 'varchar',
    length: 100,
    default: 'application/octet-stream',
  })
  mimeType: string;

  @Column({ name: 'file_size', type: 'integer', default: 0 })
  fileSize: number;

  @Column({ type: 'real', nullable: true })
  duration: number | null;

  @Column({
    name: 'review_status',
    type: 'simple-enum',
    enum: ResourceReviewStatus,
    default: ResourceReviewStatus.Pending,
  })
  reviewStatus: ResourceReviewStatus;

  // 兼容 synchronize 迁移前的开发数据库与游客数据迁移测试；新资源不再写入这两列。
  @Column({ type: 'varchar', length: 50, nullable: true })
  type: string | null;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
