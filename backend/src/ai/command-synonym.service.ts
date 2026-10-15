import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { CreateCommandSynonymDto } from './dto/command-synonym.dto';
import { TeacherCommandSynonym } from './entities/teacher-command-synonym.entity';

const BUILTIN = [
  '上一步', 'previous', 'back', '下一步', 'next', '暂停播放', 'pause', '继续播放',
  'resume', '停止播放', 'stop', '上一页', 'previous page', '下一页', 'next page',
  '放大', 'zoom in', '缩小', 'zoom out', '静音', 'mute', '取消静音', 'unmute',
  '随机点名', 'random roll call', '进入课间', 'start break', '结束课间', 'end break',
  '完成课堂', 'finish class',
];
const BLOCKED = ['不要', '先不要', '别', '不必', '不用', '吗', '什么', '怎么', '?'];

@Injectable()
export class CommandSynonymService {
  constructor(
    @InjectRepository(TeacherCommandSynonym)
    private readonly repository: Repository<TeacherCommandSynonym>,
  ) {}

  list(actor: JwtTeacherPayload) {
    this.requireTeacher(actor);
    return this.repository.find({ where: { teacherId: actor.sub }, order: { id: 'ASC' } });
  }

  async create(actor: JwtTeacherPayload, dto: CreateCommandSynonymDto) {
    this.requireTeacher(actor);
    const phrase = dto.phrase.trim();
    const normalizedPhrase = this.normalize(phrase);
    if (!normalizedPhrase) throw new BadRequestException('自定义口令不能为空');
    if (BLOCKED.some((word) => normalizedPhrase.includes(word)))
      throw new BadRequestException('自定义口令不能包含否定或疑问表达');
    const builtins = BUILTIN.map((item) => this.normalize(item));
    if (builtins.some((item) => item === normalizedPhrase || item.includes(normalizedPhrase) || normalizedPhrase.includes(item)))
      throw new ConflictException('该口令与系统内置口令冲突');
    const existing = await this.repository.findOne({ where: { teacherId: actor.sub, normalizedPhrase } });
    if (existing) throw new ConflictException('该自定义口令已经存在');
    return this.repository.save(this.repository.create({
      teacherId: actor.sub,
      phrase,
      normalizedPhrase,
      operation: dto.operation,
    }));
  }

  async remove(actor: JwtTeacherPayload, id: number) {
    this.requireTeacher(actor);
    const item = await this.repository.findOne({ where: { id, teacherId: actor.sub } });
    if (!item) throw new NotFoundException('自定义口令不存在');
    await this.repository.remove(item);
    return { success: true };
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('只有教师可以配置课堂口令');
  }

  private normalize(value: string) {
    return value.toLowerCase().replace(/[\u3000\t]/g, '').replace(/[，。！？、；：“”‘’（）《》,.!?;:'"()[\]{}<>#@&%~`^_\-=+/\\|]/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
