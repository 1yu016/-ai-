import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { SchoolClass } from './entities/school-class.entity';
import { Student } from './entities/student.entity';
import { PlatformAccessService } from './platform-access.service';
import { AuditResult, RecordStatus } from './platform.types';
import { assertStudentImportFile } from './student-import-file';

const MAX_ROWS = 500;
const SESSION_TTL_MS = 30 * 60 * 1000;

type ImportStudent = {
  studentNo: string;
  name: string;
  nickname: string | null;
  gender: string | null;
  birthday: string | null;
  status: RecordStatus;
};

export type StudentImportPreviewRow = ImportStudent & {
  rowNumber: number;
  valid: boolean;
  errors: string[];
};

type ImportSession = {
  id: string;
  actorKey: string;
  classId: number;
  className: string;
  expiresAt: number;
  rows: StudentImportPreviewRow[];
  confirmed: boolean;
  confirmRequestId?: string;
  result?: StudentImportConfirmResult;
};

type StudentImportConfirmResult = {
  sessionId: string;
  requestId: string;
  classId: number;
  created: number;
  skipped: number;
  replayed: boolean;
};

const HEADER_ALIASES = {
  studentNo: ['学号', '学生学号', 'studentno'],
  name: ['姓名', '学生姓名', 'name'],
  nickname: ['昵称', 'nickname'],
  gender: ['性别', 'gender'],
  birthday: ['生日', '出生日期', 'birthday'],
  status: ['状态', 'status'],
} as const;

@Injectable()
export class StudentImportService {
  private readonly sessions = new Map<string, ImportSession>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly access: PlatformAccessService,
    private readonly audit: AuditService,
    @InjectRepository(Student) private readonly students: Repository<Student>,
  ) {}

  async template(actor: JwtTeacherPayload, classId: number): Promise<Buffer> {
    const schoolClass = await this.requireActiveClass(actor, classId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '幼儿园数字人课堂';
    const sheet = workbook.addWorksheet('学生导入');
    sheet.columns = [
      { header: '学号', key: 'studentNo', width: 18 },
      { header: '姓名', key: 'name', width: 16 },
      { header: '昵称', key: 'nickname', width: 16 },
      { header: '性别', key: 'gender', width: 12 },
      { header: '生日', key: 'birthday', width: 16 },
      { header: '状态', key: 'status', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (let row = 2; row <= MAX_ROWS + 1; row += 1) {
      sheet.getCell(`F${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"在读,停用"'],
      };
    }
    const instructions = workbook.addWorksheet('填写说明');
    instructions.addRows([
      ['适用班级', schoolClass.name],
      ['必填列', '学号、姓名'],
      ['可选列', '昵称、性别、生日、状态'],
      ['生日格式', 'YYYY-MM-DD，例如 2021-09-01'],
      ['状态格式', '在读或停用；留空按在读处理'],
      ['数量限制', `一次最多 ${MAX_ROWS} 行，文件最大 2MB`],
      ['注意', '请勿修改“学生导入”工作表的表头，不要使用公式。'],
    ]);
    instructions.getColumn(1).width = 18;
    instructions.getColumn(2).width = 60;
    const bytes = await workbook.xlsx.writeBuffer();
    return Buffer.from(bytes);
  }

  async preview(actor: JwtTeacherPayload, classId: number, file?: Express.Multer.File) {
    const schoolClass = await this.requireActiveClass(actor, classId);
    assertStudentImportFile(file);
    this.removeExpiredSessions();

    let workbook: ExcelJS.Workbook;
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Excel 文件解析失败，请重新下载模板后填写');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Excel 文件中没有可读取的工作表');

    const headers = this.readHeaders(sheet.getRow(1));
    if (headers.studentNo == null || headers.name == null) {
      throw new BadRequestException('模板缺少必填列：学号、姓名');
    }

    const rawRows: StudentImportPreviewRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (this.rowIsEmpty(row)) continue;
      if (rawRows.length >= MAX_ROWS) {
        throw new BadRequestException(`一次最多导入 ${MAX_ROWS} 行学生数据`);
      }
      rawRows.push(this.parseRow(row, rowNumber, headers));
    }
    if (!rawRows.length) throw new BadRequestException('文件中没有可导入的学生数据');

    const duplicateNos = new Set<string>();
    const seen = new Set<string>();
    for (const row of rawRows) {
      if (!row.studentNo) continue;
      if (seen.has(row.studentNo)) duplicateNos.add(row.studentNo);
      seen.add(row.studentNo);
    }
    const existing = seen.size
      ? await this.students.find({ where: { classId, studentNo: In([...seen]) } })
      : [];
    const existingNos = new Set(existing.map((item) => item.studentNo));
    for (const row of rawRows) {
      if (duplicateNos.has(row.studentNo)) row.errors.push('文件内学号重复');
      if (existingNos.has(row.studentNo)) row.errors.push('该班级已存在相同学号');
      row.errors = [...new Set(row.errors)];
      row.valid = row.errors.length === 0;
    }

    const session: ImportSession = {
      id: randomUUID(),
      actorKey: this.actorKey(actor),
      classId,
      className: schoolClass.name,
      expiresAt: Date.now() + SESSION_TTL_MS,
      rows: rawRows,
      confirmed: false,
    };
    this.sessions.set(session.id, session);
    await this.audit.write(actor, {
      action: 'student.import.preview',
      targetType: 'class',
      targetId: classId,
      metadata: {
        sessionId: session.id,
        total: rawRows.length,
        valid: rawRows.filter((row) => row.valid).length,
        invalid: rawRows.filter((row) => !row.valid).length,
      },
    });
    return this.previewResponse(session);
  }

  async confirm(actor: JwtTeacherPayload, classId: number, sessionId: string, requestId: string) {
    await this.requireActiveClass(actor, classId);
    const session = this.requireSession(actor, classId, sessionId);
    if (session.confirmed && session.result) return { ...session.result, replayed: true };
    const validRows = session.rows.filter((row) => row.valid);
    if (!validRows.length) throw new BadRequestException('没有可确认导入的有效学生');

    try {
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Student);
        const studentNos = validRows.map((row) => row.studentNo);
        const conflicts = await repository.find({
          where: { classId, studentNo: In(studentNos) },
        });
        if (conflicts.length) {
          throw new ConflictException({
            message: '学生数据已发生变化，请重新上传并预览',
            studentNos: conflicts.map((item) => item.studentNo),
          });
        }
        await repository.save(
          validRows.map((row) =>
            repository.create({
              classId,
              studentNo: row.studentNo,
              name: row.name,
              nickname: row.nickname,
              gender: row.gender,
              birthday: row.birthday,
              status: row.status,
            }),
          ),
        );
      });
    } catch (error) {
      await this.audit.write(actor, {
        action: 'student.import.confirm',
        targetType: 'class',
        targetId: classId,
        result: AuditResult.Failure,
        metadata: { sessionId, requestId },
      });
      throw error;
    }

    session.confirmed = true;
    session.confirmRequestId = requestId;
    session.result = {
      sessionId,
      requestId,
      classId,
      created: validRows.length,
      skipped: session.rows.length - validRows.length,
      replayed: false,
    };
    await this.audit.write(actor, {
      action: 'student.import.confirm',
      targetType: 'class',
      targetId: classId,
      metadata: session.result,
    });
    return session.result;
  }

  async errorsCsv(actor: JwtTeacherPayload, classId: number, sessionId: string): Promise<Buffer> {
    await this.access.requireClassAccess(actor, classId);
    const session = this.requireSession(actor, classId, sessionId);
    const rows = session.rows.filter((row) => !row.valid);
    const lines = [
      ['行号', '学号', '姓名', '昵称', '性别', '生日', '状态', '失败原因'],
      ...rows.map((row) => [
        String(row.rowNumber), row.studentNo, row.name, row.nickname ?? '', row.gender ?? '',
        row.birthday ?? '', row.status, row.errors.join('；'),
      ]),
    ];
    const csv = `\uFEFF${lines.map((line) => line.map((value) => this.csvCell(value)).join(',')).join('\r\n')}`;
    return Buffer.from(csv, 'utf8');
  }

  private async requireActiveClass(actor: JwtTeacherPayload, classId: number): Promise<SchoolClass> {
    const schoolClass = await this.access.requireClassAccess(actor, classId);
    if (schoolClass.status !== RecordStatus.Active) {
      throw new ConflictException('停用班级不能导入学生');
    }
    return schoolClass;
  }

  private requireSession(actor: JwtTeacherPayload, classId: number, sessionId: string): ImportSession {
    this.removeExpiredSessions();
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundException('导入预览不存在或已过期，请重新上传');
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      throw new GoneException('导入预览已过期，请重新上传');
    }
    if (session.classId !== classId || session.actorKey !== this.actorKey(actor)) {
      throw new NotFoundException('导入预览不存在或已过期，请重新上传');
    }
    return session;
  }

  private previewResponse(session: ImportSession) {
    return {
      sessionId: session.id,
      classId: session.classId,
      className: session.className,
      expiresAt: new Date(session.expiresAt).toISOString(),
      summary: {
        total: session.rows.length,
        valid: session.rows.filter((row) => row.valid).length,
        invalid: session.rows.filter((row) => !row.valid).length,
      },
      validRows: session.rows.filter((row) => row.valid),
      invalidRows: session.rows.filter((row) => !row.valid),
    };
  }

  private readHeaders(row: ExcelJS.Row): Partial<Record<keyof ImportStudent, number>> {
    const headers: Partial<Record<keyof ImportStudent, number>> = {};
    row.eachCell((cell, column) => {
      const value = this.cellText(cell).toLowerCase().replace(/\s+/g, '');
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if ((aliases as readonly string[]).includes(value)) headers[key as keyof ImportStudent] = column;
      }
    });
    return headers;
  }

  private parseRow(
    row: ExcelJS.Row,
    rowNumber: number,
    headers: Partial<Record<keyof ImportStudent, number>>,
  ): StudentImportPreviewRow {
    const errors: string[] = [];
    const read = (key: keyof ImportStudent) => {
      const column = headers[key];
      if (!column) return '';
      const cell = row.getCell(column);
      if (cell.type === ExcelJS.ValueType.Formula) errors.push(`${this.headerLabel(key)}不能使用公式`);
      return this.cellText(cell).trim();
    };
    const studentNo = read('studentNo');
    const name = read('name');
    const nickname = read('nickname');
    const gender = read('gender');
    const birthdayRaw = read('birthday');
    const statusRaw = read('status');
    if (!studentNo) errors.push('学号不能为空');
    if (!name) errors.push('姓名不能为空');
    if (studentNo.length > 64) errors.push('学号不能超过64个字符');
    if (name.length > 100) errors.push('姓名不能超过100个字符');
    if (nickname.length > 100) errors.push('昵称不能超过100个字符');
    if (gender.length > 20) errors.push('性别不能超过20个字符');
    const birthday = this.parseBirthday(birthdayRaw);
    if (birthdayRaw && !birthday) errors.push('生日格式应为 YYYY-MM-DD');
    const status = this.parseStatus(statusRaw);
    if (!status) errors.push('状态只能填写“在读/active”或“停用/disabled”');
    return {
      rowNumber,
      studentNo,
      name,
      nickname: nickname || null,
      gender: gender || null,
      birthday,
      status: status ?? RecordStatus.Active,
      valid: errors.length === 0,
      errors,
    };
  }

  private cellText(cell: ExcelJS.Cell): string {
    if (cell.value == null) return '';
    if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
    if (typeof cell.value === 'object') {
      if ('text' in cell.value) return String(cell.value.text ?? '');
      if ('result' in cell.value) return String(cell.value.result ?? '');
      return '';
    }
    return String(cell.value);
  }

  private rowIsEmpty(row: ExcelJS.Row): boolean {
    let hasValue = false;
    row.eachCell((cell) => { if (this.cellText(cell).trim()) hasValue = true; });
    return !hasValue;
  }

  private parseBirthday(value: string): string | null {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
  }

  private parseStatus(value: string): RecordStatus | null {
    if (!value || value === '在读' || value.toLowerCase() === 'active') return RecordStatus.Active;
    if (value === '停用' || value.toLowerCase() === 'disabled') return RecordStatus.Disabled;
    return null;
  }

  private headerLabel(key: keyof ImportStudent): string {
    return { studentNo: '学号', name: '姓名', nickname: '昵称', gender: '性别', birthday: '生日', status: '状态' }[key];
  }

  private actorKey(actor: JwtTeacherPayload): string {
    return `${actor.userType}:${actor.sub}`;
  }

  private removeExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
  }

  private csvCell(value: string): string {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }
}
