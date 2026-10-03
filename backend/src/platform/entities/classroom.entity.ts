import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RecordStatus } from '../platform.types';

@Entity({ name: 'classroom' })
@Index(['schoolId', 'name'], { unique: true })
export class Classroom {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) location:
    string | null;
  @Column({
    type: 'simple-enum',
    enum: RecordStatus,
    default: RecordStatus.Active,
  })
  status: RecordStatus;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
