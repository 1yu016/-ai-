import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'resource_reference' })
@Index(['resourceId', 'referenceType', 'referenceId'], { unique: true })
export class ResourceReference {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'resource_id', type: 'integer' }) resourceId: number;
  @Column({ name: 'reference_type', type: 'varchar', length: 50 })
  referenceType: string;
  @Column({ name: 'reference_id', type: 'varchar', length: 100 })
  referenceId: string;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
