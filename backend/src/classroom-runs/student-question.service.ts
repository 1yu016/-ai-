import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Brackets, In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { Teacher } from '../auth/entities/teacher.entity';
import { ResourceReviewStatus } from '../data/entities/teaching-resource.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { Student } from '../platform/entities/student.entity';
import { RecordStatus } from '../platform/platform.types';
import { ResourceService } from '../resources/resource.service';
import {
  ClassQuestionQueryDto,
  CreateStudentQuestionDto,
  QuestionMapQueryDto,
  UpdateStudentQuestionDto,
} from './dto/student-question.dto';
import { ClassroomRun } from './entities/classroom-run.entity';
import { StudentQuestionRecord } from './entities/student-question-record.entity';
import { QuestionMapAiService } from './question-map-ai.service';

type QuestionView = {
  id: number;
  studentId: number | null;
  studentName: string | null;
  classId: number;
  classroomRunId: number;
  lessonStepIndex: number | null;
  asrRawText: string;
  teacherCorrectedText: string | null;
  questionText: string;
  topic: string | null;
  domain: string | null;
  isAnonymous: boolean;
  teacherId: number;
  teacherName: string | null;
  lessonTitle: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class StudentQuestionService {
  constructor(
    @InjectRepository(StudentQuestionRecord)
    private readonly records: Repository<StudentQuestionRecord>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(Teacher)
    private readonly teachers: Repository<Teacher>,
    private readonly access: PlatformAccessService,
    private readonly resources: ResourceService,
    private readonly questionMapAi: QuestionMapAiService,
  ) {}

  async create(actor: JwtTeacherPayload, runId: number, dto: CreateStudentQuestionDto) {
    this.requireTeacher(actor);
    const run = await this.requireRun(actor, runId);
    const rawText = (dto.asrRawText ?? dto.questionText ?? '').trim();
    if (!rawText) throw new BadRequestException('ASR原始文本或问题文本不能为空');
    const corrected = dto.teacherCorrectedText?.trim() || null;
    const studentId = dto.isAnonymous ? null : (dto.studentId ?? null);
    if (studentId != null) await this.requireStudent(run.classId, studentId);
    const payload = {
      studentId,
      lessonStepIndex: dto.lessonStepIndex ?? null,
      asrRawText: rawText,
      teacherCorrectedText: corrected,
      topic: dto.topic?.trim() || null,
      domain: dto.domain?.trim() || null,
      isAnonymous: dto.isAnonymous === true,
    };
    const requestHash = this.hash(payload);
    const existing = await this.records.findOne({ where: { classroomRunId: runId, requestId: dto.requestId } });
    if (existing) return { question: await this.replay(existing, requestHash) };
    try {
      const saved = await this.records.save(this.records.create({
        ...payload,
        classId: run.classId,
        classroomRunId: runId,
        questionText: corrected || rawText,
        teacherId: actor.sub,
        requestId: dto.requestId,
        requestHash,
      }));
      return { question: await this.toView(saved) };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const repeated = await this.records.findOne({ where: { classroomRunId: runId, requestId: dto.requestId } });
      if (!repeated) throw error;
      return { question: await this.replay(repeated, requestHash) };
    }
  }

  async update(actor: JwtTeacherPayload, runId: number, questionId: number, dto: UpdateStudentQuestionDto) {
    this.requireTeacher(actor);
    await this.requireRun(actor, runId);
    const record = await this.records.findOne({ where: { id: questionId, classroomRunId: runId } });
    if (!record) throw new NotFoundException('问题记录不存在');
    if (dto.teacherCorrectedText !== undefined) {
      record.teacherCorrectedText = dto.teacherCorrectedText.trim();
      record.questionText = record.teacherCorrectedText;
    }
    if (dto.topic !== undefined) record.topic = dto.topic?.trim() || null;
    if (dto.domain !== undefined) record.domain = dto.domain?.trim() || null;
    if (dto.isAnonymous !== undefined) {
      record.isAnonymous = dto.isAnonymous;
      if (dto.isAnonymous) record.studentId = null;
    }
    return { question: await this.toView(await this.records.save(record)) };
  }

  async listRun(actor: JwtTeacherPayload, runId: number): Promise<QuestionView[]> {
    await this.requireRun(actor, runId);
    const records = await this.records.find({
      where: { classroomRunId: runId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return this.toViews(records);
  }

  async listClass(actor: JwtTeacherPayload, classId: number, query: ClassQuestionQueryDto) {
    await this.access.requireClassAccess(actor, classId);
    if (query.studentId) await this.requireStudent(classId, query.studentId);
    const builder = this.filteredQuery(classId, query);
    const [records, total] = await builder
      .orderBy('q.created_at', 'DESC')
      .addOrderBy('q.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return { items: await this.toViews(records), total, page: query.page, pageSize: query.pageSize };
  }

  async map(actor: JwtTeacherPayload, classId: number, query: QuestionMapQueryDto) {
    await this.access.requireClassAccess(actor, classId);
    if (query.studentId) await this.requireStudent(classId, query.studentId);
    const records = await this.filteredQuery(classId, query).orderBy('q.created_at', 'DESC').getMany();
    const topics = this.count(records.map((item) => item.topic || '未分类'));
    const domains = this.count(records.map((item) => item.domain || '未分类'));
    const frequentQuestions = this.count(records.map((item) => this.normalizeQuestion(item.questionText)))
      .slice(0, 10)
      .map((item) => ({ question: item.name, count: item.count }));
    const hotspotNames = [...topics.slice(0, 3), ...domains.slice(0, 2)]
      .filter((item) => item.name !== '未分类')
      .map((item) => item.name);
    const recommendedResources = await this.recommendResources(actor, hotspotNames);
    const canViewIndividuals = actor.userType === AuthUserType.Teacher;
    const studentClusters = canViewIndividuals
      ? await this.studentClusters(records.filter((item) => !item.isAnonymous && item.studentId != null))
      : [];
    const focus = hotspotNames[0] ?? '幼儿近期提出的问题';
    const suggestions = await this.questionMapAi.generate(
      { total: records.length, topics: topics.slice(0, 10), domains: domains.slice(0, 10) },
      {
        teachingSuggestions: records.length
          ? [
              `围绕“${focus}”安排一次观察、表达和验证活动，先请幼儿说出自己的发现。`,
              '选择出现频率较高的问题进行集体讨论，同时保留不同幼儿的表达方式。',
              '用图片、实物或小实验继续追问“你看到了什么”“你是怎么知道的”。',
            ]
          : ['当前筛选范围还没有问题记录，可在课堂互动后再生成教学建议。'],
        activitySuggestions: records.length
          ? ['问题分类贴纸墙', '两人观察与分享', '围绕热点问题开展安全小实验']
          : [],
      },
    );
    return {
      classId,
      filters: { topic: query.topic ?? null, domain: query.domain ?? null, studentId: query.studentId ?? null },
      summary: {
        total: records.length,
        anonymousCount: records.filter((item) => item.isAnonymous).length,
        identifiedStudentCount: new Set(records.filter((item) => !item.isAnonymous).map((item) => item.studentId).filter(Boolean)).size,
      },
      topics,
      domains,
      frequentQuestions,
      interestHotspots: hotspotNames,
      studentClusters,
      suggestionSource: suggestions.source,
      teachingSuggestions: suggestions.teachingSuggestions,
      activitySuggestions: suggestions.activitySuggestions,
      recommendedResources,
      safety: {
        individualRankingGenerated: false,
        negativeLabelsGenerated: false,
        note: '问题地图用于发现兴趣与教学线索，不评价幼儿能力、人格或品行。',
      },
    };
  }

  private filteredQuery(classId: number, query: { studentId?: number; keyword?: string; topic?: string; domain?: string }) {
    const builder = this.records.createQueryBuilder('q').where('q.class_id = :classId', { classId });
    if (query.studentId) builder.andWhere('q.student_id = :studentId AND q.is_anonymous = 0', { studentId: query.studentId });
    if (query.topic) builder.andWhere('q.topic = :topic', { topic: query.topic });
    if (query.domain) builder.andWhere('q.domain = :domain', { domain: query.domain });
    if (query.keyword) {
      const keyword = `%${query.keyword.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
      builder.andWhere(new Brackets((nested) => nested
        .where("q.question_text LIKE :keyword ESCAPE '\\'", { keyword })
        .orWhere("q.asr_raw_text LIKE :keyword ESCAPE '\\'", { keyword })
        .orWhere("q.teacher_corrected_text LIKE :keyword ESCAPE '\\'", { keyword })));
    }
    return builder;
  }

  private async requireRun(actor: JwtTeacherPayload, runId: number) {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('课堂运行不存在');
    await this.access.requireClassAccess(actor, run.classId);
    return run;
  }

  private async requireStudent(classId: number, studentId: number) {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('学生不存在');
    if (student.classId !== classId) throw new ForbiddenException('不能记录其他班级幼儿的问题');
    if (student.status !== RecordStatus.Active) throw new ConflictException('学生已停用');
    return student;
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher) throw new ForbiddenException('管理员不能代替教师记录或修改课堂问题');
  }

  private replay(record: StudentQuestionRecord, requestHash: string) {
    if (record.requestHash !== requestHash) throw new ConflictException('同一requestId已用于不同的问题内容');
    return this.toView(record);
  }

  private hash(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private isUniqueViolation(error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    return code.includes('CONSTRAINT') || code === '23505';
  }

  private count(values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }

  private normalizeQuestion(value: string) {
    return value.trim().replace(/[？?！!。.]+$/u, '') || value.trim();
  }

  private async studentClusters(records: StudentQuestionRecord[]) {
    const ids = [...new Set(records.map((item) => item.studentId).filter((id): id is number => id != null))];
    const students = ids.length ? await this.students.find({ where: { id: In(ids) } }) : [];
    const names = new Map(students.map((student) => [student.id, student.nickname || student.name]));
    return ids.map((studentId) => {
      const own = records.filter((item) => item.studentId === studentId);
      return {
        studentId,
        studentName: names.get(studentId) ?? '幼儿',
        questionCount: own.length,
        topics: this.count(own.map((item) => item.topic || '未分类')).slice(0, 5),
        domains: this.count(own.map((item) => item.domain || '未分类')).slice(0, 5),
      };
    });
  }

  private async recommendResources(actor: JwtTeacherPayload, keywords: string[]) {
    const result = new Map<number, { id: number; title: string; resourceType: string; domain: string | null }>();
    for (const keyword of keywords.slice(0, 3)) {
      const matches = await this.resources.search(actor, keyword).catch(() => []);
      for (const resource of matches) {
        if (resource.reviewStatus !== ResourceReviewStatus.Approved) continue;
        result.set(resource.id, { id: resource.id, title: resource.title, resourceType: resource.resourceType, domain: resource.domain });
        if (result.size >= 6) break;
      }
      if (result.size >= 6) break;
    }
    return [...result.values()];
  }

  private async toViews(records: StudentQuestionRecord[]) {
    return Promise.all(records.map((record) => this.toView(record)));
  }

  private async toView(record: StudentQuestionRecord): Promise<QuestionView> {
    const [student, teacher, run] = await Promise.all([
      record.studentId == null ? null : this.students.findOne({ where: { id: record.studentId } }),
      this.teachers.findOne({ where: { id: record.teacherId } }),
      this.runs.findOne({ where: { id: record.classroomRunId } }),
    ]);
    return {
      id: record.id,
      studentId: record.isAnonymous ? null : record.studentId,
      studentName: record.isAnonymous ? null : (student?.nickname || student?.name || null),
      classId: record.classId,
      classroomRunId: record.classroomRunId,
      lessonStepIndex: record.lessonStepIndex,
      asrRawText: record.asrRawText,
      teacherCorrectedText: record.teacherCorrectedText,
      questionText: record.questionText,
      topic: record.topic,
      domain: record.domain,
      isAnonymous: record.isAnonymous,
      teacherId: record.teacherId,
      teacherName: teacher?.name ?? null,
      lessonTitle: run?.title ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
