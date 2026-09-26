import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OwnedEntity } from './owned.entity';

export enum ChatMessageRole {
  User = 'user',
  Assistant = 'assistant',
}

@Entity({ name: 'chat_message' })
export class ChatMessage extends OwnedEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'session_id', type: 'integer' })
  sessionId: number;

  @Column({ type: 'simple-enum', enum: ChatMessageRole })
  role: ChatMessageRole;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
