import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AvatarActionName, AvatarAssetType } from '../avatar.types';

@Entity({ name: 'avatar_asset' })
@Index(['versionId', 'assetType', 'actionName'])
export class AvatarAsset {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'version_id', type: 'integer' })
  versionId: number;
  @Column({ name: 'asset_type', type: 'simple-enum', enum: AvatarAssetType })
  assetType: AvatarAssetType;
  @Column({
    name: 'action_name',
    type: 'simple-enum',
    enum: AvatarActionName,
    nullable: true,
  })
  actionName: AvatarActionName | null;
  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;
  @Column({ name: 'file_path', type: 'varchar', length: 500 })
  filePath: string;
  @Column({ name: 'mime_type', type: 'varchar', length: 150 })
  mimeType: string;
  @Column({ name: 'file_size', type: 'integer' }) fileSize: number;
  @Column({ type: 'varchar', length: 64 }) checksum: string;
  @Column({ type: 'text', default: '{}' }) metadata: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
