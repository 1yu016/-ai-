import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Teacher, TeacherRole } from './entities/teacher.entity';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class TeacherSeederService implements OnModuleInit {
  private readonly logger = new Logger(TeacherSeederService.name);

  constructor(
    @InjectRepository(Teacher)
    private readonly teacherRepository: Repository<Teacher>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const account = this.configService
      .get<string>('TEST_TEACHER_ACCOUNT')
      ?.trim();
    const password = this.configService.get<string>('TEST_TEACHER_PASSWORD');
    const name = this.configService.get<string>('TEST_TEACHER_NAME')?.trim();
    const roleValue = this.configService
      .get<string>('TEST_TEACHER_ROLE')
      ?.trim();
    const schoolId = this.configService
      .get<string>('TEST_TEACHER_SCHOOL_ID')
      ?.trim();

    if (!account && !password && !name) {
      return;
    }
    if (!account || !password || !name) {
      throw new Error(
        '测试教师配置不完整，请同时设置 TEST_TEACHER_ACCOUNT、TEST_TEACHER_PASSWORD、TEST_TEACHER_NAME',
      );
    }
    if (roleValue && !Object.values(TeacherRole).includes(roleValue as TeacherRole)) {
      throw new Error('TEST_TEACHER_ROLE 仅支持 teacher 或 admin');
    }

    const existing = await this.teacherRepository.findOne({
      where: { account },
    });
    if (existing) {
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.teacherRepository.save(
      this.teacherRepository.create({
        account,
        passwordHash,
        name,
        role: (roleValue as TeacherRole | undefined) ?? TeacherRole.Teacher,
        schoolId: schoolId || null,
      }),
    );
    this.logger.log(`测试教师账号 ${account} 已创建`);
  }
}
