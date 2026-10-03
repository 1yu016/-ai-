import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeviceStatus, DeviceType } from '../platform.types';

@Entity({ name: 'device' })
export class Device {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column({ name: 'device_code', type: 'varchar', length: 100 })
  deviceCode: string;
  @Index()
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({
    type: 'simple-enum',
    enum: DeviceType,
    default: DeviceType.ClassroomScreen,
  })
  type: DeviceType;
  @Column({
    type: 'simple-enum',
    enum: DeviceStatus,
    default: DeviceStatus.Offline,
  })
  status: DeviceStatus;
  @Column({ name: 'last_online_at', type: 'datetime', nullable: true })
  lastOnlineAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}
