import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'classroom_ticket' })
export class ClassroomTicket {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true })
  @Column({ name: 'ticket_hash', type: 'varchar', length: 64 })
  ticketHash: string;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Index() @Column({ name: 'device_id', type: 'integer' }) deviceId: number;
  @Column({ name: 'classroom_id', type: 'integer' }) classroomId: number;
  @Column({ name: 'lesson_run_id', type: 'integer', nullable: true })
  lessonRunId: number | null;
  @Column({ name: 'expires_at', type: 'datetime' }) expiresAt: Date;
  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt: Date | null;
  @Column({ name: 'is_used', type: 'boolean', default: false }) isUsed: boolean;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
