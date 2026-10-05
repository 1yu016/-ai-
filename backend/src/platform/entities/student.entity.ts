import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RecordStatus } from '../platform.types';

@Entity({ name: 'student' })
@Index(['classId', 'studentNo'], { unique: true })
export class Student {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'student_no', type: 'varchar', length: 64 })
  studentNo: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) nickname:
    string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) gender:
    string | null;
  @Column({ type: 'date', nullable: true }) birthday: string | null;
  @Column({
    type: 'simple-enum',
    enum: RecordStatus,
    default: RecordStatus.Active,
  })
  status: RecordStatus;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
