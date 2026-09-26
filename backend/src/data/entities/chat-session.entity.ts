import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OwnedEntity } from './owned.entity';

@Entity({ name: 'session' })
export class ChatSession extends OwnedEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @Column({ name: 'last_active_at', type: 'datetime' })
  lastActiveAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
