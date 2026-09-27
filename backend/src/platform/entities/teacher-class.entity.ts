import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeacherClassRole } from '../platform.types';

@Entity({ name: 'teacher_class' })
@Index(['teacherId', 'classId'], { unique: true })
export class TeacherClass {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({
    type: 'simple-enum',
    enum: TeacherClassRole,
    default: TeacherClassRole.Assistant,
  })
  role: TeacherClassRole;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
