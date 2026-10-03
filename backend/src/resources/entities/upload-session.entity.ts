import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';
import {
  ResourceAgeGroup,
  ResourceType,
} from '../../data/entities/teaching-resource.entity';

export enum UploadSessionStatus {
  Active = 'active',
  Merging = 'merging',
  Completed = 'completed',
  Aborted = 'aborted',
  Expired = 'expired',
  Failed = 'failed',
}

@Entity({ name: 'upload_session' })
export class UploadSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'user_id', type: 'integer' }) userId: number;
  @Column({ name: 'user_type', type: 'simple-enum', enum: AuthUserType })
  userType: AuthUserType;
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;
  @Column({ name: 'declared_mime', type: 'varchar', length: 150 })
  declaredMime: string;
  @Column({ name: 'resource_type', type: 'simple-enum', enum: ResourceType })
  resourceType: ResourceType;
  @Column({ type: 'varchar', length: 100 }) category: string;
  @Column({ name: 'age_group', type: 'simple-enum', enum: ResourceAgeGroup })
  ageGroup: ResourceAgeGroup;
  @Column({ name: 'total_size', type: 'integer' }) totalSize: number;
  @Column({ name: 'chunk_size', type: 'integer' }) chunkSize: number;
  @Column({ name: 'total_chunks', type: 'integer' }) totalChunks: number;
  @Column({
    name: 'expected_sha256',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  expectedSha256: string | null;
  @Column({
    type: 'simple-enum',
    enum: UploadSessionStatus,
    default: UploadSessionStatus.Active,
  })
  status: UploadSessionStatus;
  @Column({ name: 'expires_at', type: 'datetime' }) expiresAt: Date;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}

@Entity({ name: 'upload_chunk' })
@Index(['sessionId', 'chunkNo'], { unique: true })
export class UploadChunk {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'session_id', type: 'varchar', length: 36 })
  sessionId: string;
  @Column({ name: 'chunk_no', type: 'integer' }) chunkNo: number;
  @Column({ name: 'file_size', type: 'integer' }) fileSize: number;
  @Column({ type: 'varchar', length: 64 }) sha256: string;
  @Column({ name: 'storage_path', type: 'varchar', length: 500 })
  storagePath: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
