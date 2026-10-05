import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { TeacherRole } from '../auth/entities/teacher.entity';
import { SchoolClass } from './entities/school-class.entity';
import { Student } from './entities/student.entity';
import { TeacherClass } from './entities/teacher-class.entity';

@Injectable()
export class PlatformAccessService {
  constructor(
    @InjectRepository(TeacherClass)
    private readonly teacherClasses: Repository<TeacherClass>,
    @InjectRepository(SchoolClass)
    private readonly classes: Repository<SchoolClass>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
  ) {}

  isAdministrator(actor: JwtTeacherPayload): boolean {
    return (
      actor.userType === AuthUserType.Administrator ||
      actor.role === TeacherRole.Admin
    );
  }

  requireAdministrator(actor: JwtTeacherPayload): void {
    if (!this.isAdministrator(actor))
      throw new ForbiddenException('仅管理员可以执行该操作');
  }

  async requireClassAccess(
    actor: JwtTeacherPayload,
    classId: number,
  ): Promise<SchoolClass> {
    const schoolClass = await this.classes.findOne({ where: { id: classId } });
    if (!schoolClass) throw new NotFoundException('班级不存在');
    if (
      actor.schoolId &&
      schoolClass.schoolId &&
      actor.schoolId !== schoolClass.schoolId
    ) {
      throw new ForbiddenException('无权访问其他园所数据');
    }
    if (this.isAdministrator(actor)) return schoolClass;
    const relation = await this.teacherClasses.findOne({
      where: { teacherId: actor.sub, classId },
    });
    if (!relation) throw new ForbiddenException('无权访问该班级');
    return schoolClass;
  }

  async requireStudentAccess(
    actor: JwtTeacherPayload,
    studentId: number,
  ): Promise<Student> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('学生不存在');
    await this.requireClassAccess(actor, student.classId);
    return student;
  }
}
