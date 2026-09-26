import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'visitor_migration' })
export class VisitorMigration {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'visitor_id', type: 'varchar', length: 128, unique: true })
  visitorId: string;

  @Column({ name: 'teacher_id', type: 'varchar', length: 128 })
  teacherId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
