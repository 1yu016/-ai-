import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AuthUserType } from '../../auth/entities/refresh-token-session.entity';
import { BindingStatus } from '../platform.types';

@Entity({ name: 'device_binding' })
@Index(['deviceId', 'status'])
export class DeviceBinding {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'device_id', type: 'integer' }) deviceId: number;
  @Index()
  @Column({ name: 'classroom_id', type: 'integer' })
  classroomId: number;
  @Index() @Column({ name: 'class_id', type: 'integer' }) classId: number;
  @Column({ name: 'bound_by_type', type: 'simple-enum', enum: AuthUserType })
  boundByType: AuthUserType;
  @Column({ name: 'bound_by', type: 'integer' }) boundBy: number;
  @Column({ name: 'bound_at', type: 'datetime' }) boundAt: Date;
  @Column({ name: 'unbound_at', type: 'datetime', nullable: true })
  unboundAt: Date | null;
  @Column({
    type: 'simple-enum',
    enum: BindingStatus,
    default: BindingStatus.Active,
  })
  status: BindingStatus;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
