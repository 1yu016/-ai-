import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Administrator } from './entities/administrator.entity';

@Injectable()
export class AdministratorSeederService implements OnModuleInit {
  constructor(
    @InjectRepository(Administrator)
    private readonly administrators: Repository<Administrator>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const account = this.config.get<string>('INITIAL_ADMIN_ACCOUNT')?.trim();
    const password = this.config.get<string>('INITIAL_ADMIN_PASSWORD');
    const name = this.config.get<string>('INITIAL_ADMIN_NAME')?.trim();
    if (!account && !password && !name) return;
    if (!account || !password || !name)
      throw new Error('管理员初始化配置不完整');
    if (await this.administrators.findOne({ where: { account } })) return;
    await this.administrators.save(
      this.administrators.create({
        account,
        passwordHash: await bcrypt.hash(password, 12),
        name,
        schoolId:
          this.config.get<string>('INITIAL_ADMIN_SCHOOL_ID')?.trim() || null,
      }),
    );
  }
}
