import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';

@Entity({ name: 'resource_version' })
@Index(['resourceId', 'versionNo'], { unique: true })
export class ResourceVersion {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'resource_id', type: 'integer' }) resourceId: number;
  @Column({ name: 'version_no', type: 'integer' }) versionNo: number;
  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;
  @Column({ name: 'storage_name', type: 'varchar', length: 100 })
  storageName: string;
  @Column({ name: 'storage_path', type: 'varchar', length: 500 })
  storagePath: string;
  @Index() @Column({ type: 'varchar', length: 64 }) sha256: string;
  @Column({ name: 'mime_type', type: 'varchar', length: 150 }) mimeType: string;
  @Column({ name: 'file_size', type: 'integer' }) fileSize: number;
  @Column({ type: 'real', nullable: true }) duration: number | null;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @Column({ name: 'created_by_type', type: 'simple-enum', enum: AuthUserType })
  createdByType: AuthUserType;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
