import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OwnedEntity } from './owned.entity';

@Entity({ name: 'check_in' })
export class CheckIn extends OwnedEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'check_in_at', type: 'datetime' })
  checkInAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
