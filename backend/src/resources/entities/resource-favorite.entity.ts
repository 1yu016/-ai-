import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'resource_favorite' })
@Index(['teacherId', 'resourceId'], { unique: true })
export class ResourceFavorite {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'teacher_id', type: 'integer' }) teacherId: number;
  @Index() @Column({ name: 'resource_id', type: 'integer' }) resourceId: number;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}
