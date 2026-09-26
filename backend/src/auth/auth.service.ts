import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from './auth.types';
import { Teacher } from './entities/teacher.entity';

export type LoginResult = {
  access_token: string;
  teacherId: number;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Teacher)
    private readonly teacherRepository: Repository<Teacher>,
    private readonly jwtService: JwtService,
  ) {}

  async login(account: string, password: string): Promise<LoginResult> {
    const normalizedAccount = account.trim();
    const teacher = await this.teacherRepository
      .createQueryBuilder('teacher')
      .addSelect('teacher.passwordHash')
      .where('teacher.account = :account', { account: normalizedAccount })
      .getOne();

    if (!teacher || !(await bcrypt.compare(password, teacher.passwordHash))) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const payload: JwtTeacherPayload = {
      sub: teacher.id,
      account: teacher.account,
      name: teacher.name,
      role: teacher.role,
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      teacherId: teacher.id,
    };
  }
}
