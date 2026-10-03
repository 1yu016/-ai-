import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'resource_tag' })
export class ResourceTag {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  name: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
}

@Entity({ name: 'resource_tag_relation' })
@Index(['resourceId', 'tagId'], { unique: true })
export class ResourceTagRelation {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column({ name: 'resource_id', type: 'integer' }) resourceId: number;
  @Index() @Column({ name: 'tag_id', type: 'integer' }) tagId: number;
}
