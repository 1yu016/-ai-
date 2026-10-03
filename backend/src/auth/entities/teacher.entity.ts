import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TeacherRole {
  Teacher = 'teacher',
  Admin = 'admin',
}

export enum AccountStatus {
  Active = 'active',
  Disabled = 'disabled',
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

  @Column({
    type: 'simple-enum',
    enum: AccountStatus,
    default: AccountStatus.Active,
  })
  status: AccountStatus;

  @Column({ name: 'token_version', type: 'integer', default: 0 })
  tokenVersion: number;

  @Index()
  @Column({ name: 'school_id', type: 'varchar', length: 64, nullable: true })
  schoolId: string | null;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
