import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClassroomCommandV2Intent } from '../dto/classroom-command-v2.dto';

@Entity({ name: 'classroom_command_rule' })
@Index(['teacherId', 'locale', 'normalizedPhrase'], { unique: true })
export class ClassroomCommandRule {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ type: 'varchar', length: 10 }) locale: string;
  @Column({ type: 'varchar', length: 100 }) phrase: string;
  @Column({ name: 'normalized_phrase', type: 'varchar', length: 100 })
  normalizedPhrase: string;
  @Column({ type: 'simple-enum', enum: ClassroomCommandV2Intent })
  intent: ClassroomCommandV2Intent;
  @Column({ name: 'parameter_template', type: 'text', default: '{}' })
  parameterTemplate: string;
  @Column({ type: 'integer', default: 200 }) priority: number;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ name: 'valid_until', type: 'datetime', nullable: true })
  validUntil: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
