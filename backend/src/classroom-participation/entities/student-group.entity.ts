import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'student_group' })
@Index(['classroomRunId', 'name'], { unique: true })
export class StudentGroup {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) description:
    string | null;
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;
  @Column({ name: 'membership_snapshot', type: 'text', default: '[]' })
  membershipSnapshot: string;
  @Index()
  @Column({
    name: 'batch_request_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  batchRequestId: string | null;
  @Column({ name: 'created_by', type: 'integer' }) createdBy: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;
}
