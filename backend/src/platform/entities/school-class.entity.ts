import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RecordStatus } from '../platform.types';

@Entity({ name: 'class' })
@Index(['schoolId', 'name', 'schoolYear'], { unique: true })
export class SchoolClass {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({ length: 100 }) name: string;
  @Column({ type: 'varchar', length: 50, nullable: true }) grade: string | null;
  @Column({ name: 'age_range', type: 'varchar', length: 50, nullable: true })
  ageRange: string | null;
  @Column({ name: 'school_year', type: 'varchar', length: 20 })
  schoolYear: string;
  @Column({
    type: 'simple-enum',
    enum: RecordStatus,
    default: RecordStatus.Active,
  })
  status: RecordStatus;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
