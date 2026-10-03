import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'resource_category' })
@Index(['parentId', 'name'], { unique: true })
export class ResourceCategory {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'parent_id', type: 'integer', nullable: true }) parentId:
    number | null;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'integer', default: 0 }) sort: number;
  @Column({ type: 'boolean', default: true }) enabled: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
