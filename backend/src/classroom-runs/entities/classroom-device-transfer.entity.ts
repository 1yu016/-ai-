import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'classroom_device_transfer' })
export class ClassroomDeviceTransfer {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column({ name: 'classroom_run_id', type: 'integer' })
  classroomRunId: number;
  @Column({ name: 'old_device_id', type: 'integer' }) oldDeviceId: number;
  @Column({ name: 'new_device_id', type: 'integer' }) newDeviceId: number;
  @Column({ name: 'operator_id', type: 'integer' }) operatorId: number;
  @Column({ type: 'varchar', length: 500 }) reason: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
