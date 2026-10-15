import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'student_group_member' })
@Index(['groupId', 'studentId'], { unique: true })
export class StudentGroupMember {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'group_id', type: 'integer' }) groupId: number;
  @Index() @Column({ name: 'student_id', type: 'integer' }) studentId: number;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @Column({ name: 'added_by', type: 'integer' }) addedBy: number;
  @Column({ name: 'added_at', type: 'datetime' }) addedAt: Date;
  @Column({ name: 'removed_at', type: 'datetime', nullable: true })
  removedAt: Date | null;
}
