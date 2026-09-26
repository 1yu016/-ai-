import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TeacherRole {
  Teacher = 'teacher',
  Admin = 'admin',
}

@Entity({ name: 'teachers' })
export class Teacher {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 64 })
  account: string;

  @Column({ name: 'password_hash', length: 255, select: false })
  passwordHash: string;

  @Column({ length: 100 })
  name: string;

  @Column({
    type: 'simple-enum',
    enum: TeacherRole,
    default: TeacherRole.Teacher,
  })
  role: TeacherRole;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
