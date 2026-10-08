import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ClassroomCommandOperation } from '../../classroom-runs/classroom-command.types';

@Entity({ name: 'teacher_command_synonym' })
@Index(['teacherId', 'normalizedPhrase'], { unique: true })
export class TeacherCommandSynonym {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Column({ type: 'varchar', length: 40 }) phrase: string;
  @Column({ name: 'normalized_phrase', type: 'varchar', length: 40 }) normalizedPhrase: string;
  @Column({ type: 'varchar', length: 50 }) operation: ClassroomCommandOperation;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
