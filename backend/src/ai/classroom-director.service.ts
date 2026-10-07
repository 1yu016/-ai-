import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { ClassroomCommandService } from '../classroom-runs/classroom-command.service';
import { ClassroomCommandSource, ClassroomCommandOperation } from '../classroom-runs/classroom-command.types';
import { ClassroomRunService } from '../classroom-runs/classroom-run.service';
import { ResourceService } from '../resources/resource.service';
import { AuditService } from '../platform/audit.service';
import { AuditResult } from '../platform/platform.types';
import { AiService } from './ai.service';
import {
  ClassroomDirectorRequestDto,
  ClassroomDirectorResultStatus,
  DirectorSuggestionDecisionDto,
  DirectorSuggestionEditDto,
} from './dto/classroom-director.dto';
import {
  ClassroomDirectorSuggestion,
  DirectorSuggestionStatus,
} from './entities/classroom-director-suggestion.entity';

@Injectable()
export class ClassroomDirectorService {
  constructor(
    @InjectRepository(ClassroomDirectorSuggestion)
    private readonly suggestions: Repository<ClassroomDirectorSuggestion>,
    private readonly ai: AiService,
    private readonly runs: ClassroomRunService,
    private readonly commands: ClassroomCommandService,
    private readonly resources: ResourceService,
    private readonly audit: AuditService,
  ) {}

  async generate(actor: JwtTeacherPayload, dto: ClassroomDirectorRequestDto) {
    this.requireTeacher(actor);
    const run = await this.runs.get(actor, dto.classroomRunId);
    const startedAt = Date.now();
    const result = await this.ai.classroomDirector(dto);
    await this.audit.writeAi({
      actor,
      feature: 'classroom_director',
      status: result.status,
      latencyMs: Date.now() - startedAt,
      metadata: { classroomRunId: dto.classroomRunId, suggestionCount: result.suggestions.length },
    });
    if (result.status !== ClassroomDirectorResultStatus.Ready) {
      await this.audit.write(actor, {
        action: `classroom_director.${result.status}`,
        targetType: 'classroom_run',
        targetId: dto.classroomRunId,
        result: result.status === ClassroomDirectorResultStatus.SafetyRedirect
          ? AuditResult.Success
          : AuditResult.Failure,
        metadata: { message: result.message },
      });
      return { ...result, classroomRunVersion: run.version, suggestions: [] };
    }

    const saved: ClassroomDirectorSuggestion[] = [];
    for (const item of result.suggestions) {
      let resourceId = item.resourceId ?? null;
      let commandOperation = item.commandOperation ?? null;
      const parameters = { ...item.commandParameters };
      if (resourceId != null) {
        try {
          await this.resources.getOne(actor, resourceId);
          parameters.resourceId = resourceId;
        } catch {
          resourceId = null;
          if (
            commandOperation === ClassroomCommandOperation.OpenResource ||
            commandOperation === ClassroomCommandOperation.PlayResource
          ) commandOperation = null;
        }
      }
      saved.push(await this.suggestions.save(this.suggestions.create({
        classroomRunId: dto.classroomRunId,
        teacherId: actor.sub,
        type: item.type,
        title: item.title,
        originalContent: item.content,
        currentContent: item.content,
        rationale: item.rationale,
        resourceId,
        commandOperation,
        commandParameters: Object.keys(parameters).length ? JSON.stringify(parameters) : null,
        status: DirectorSuggestionStatus.Pending,
        confirmedRequestId: null,
      })));
    }
    await this.audit.write(actor, {
      action: 'classroom_director.generated',
      targetType: 'classroom_run',
      targetId: dto.classroomRunId,
      metadata: { suggestionIds: saved.map((item) => item.id) },
    });
    return {
      mode: result.mode,
      status: result.status,
      message: result.message,
      classroomRunVersion: run.version,
      suggestions: saved.map((item) => this.view(item)),
    };
  }

  async edit(actor: JwtTeacherPayload, id: number, dto: DirectorSuggestionEditDto) {
    const item = await this.ownedPending(actor, id);
    const before = item.currentContent;
    item.currentContent = dto.content.trim();
    const saved = await this.suggestions.save(item);
    await this.audit.write(actor, {
      action: 'classroom_director.edited', targetType: 'director_suggestion', targetId: id,
      metadata: { classroomRunId: item.classroomRunId, before, after: saved.currentContent },
    });
    return this.view(saved);
  }

  async reject(actor: JwtTeacherPayload, id: number) {
    const item = await this.ownedPending(actor, id);
    item.status = DirectorSuggestionStatus.Rejected;
    await this.suggestions.save(item);
    await this.audit.write(actor, {
      action: 'classroom_director.rejected', targetType: 'director_suggestion', targetId: id,
      metadata: { classroomRunId: item.classroomRunId },
    });
    return this.view(item);
  }

  async confirm(actor: JwtTeacherPayload, id: number, dto: DirectorSuggestionDecisionDto) {
    const item = await this.owned(actor, id);
    if (item.status === DirectorSuggestionStatus.Confirmed) {
      if (item.confirmedRequestId === dto.requestId)
        return { suggestion: this.view(item), commandResult: null, replayed: true };
      throw new ConflictException('该建议已经确认，不能重复执行');
    }
    if (item.status !== DirectorSuggestionStatus.Pending)
      throw new ConflictException('该建议已经被忽略');

    let commandResult: unknown = null;
    try {
      if (item.commandOperation) {
        const stored = this.parseParameters(item.commandParameters);
        const parameters = { ...stored, ...dto.commandParameters };
        if (item.resourceId != null) {
          await this.resources.getOne(actor, item.resourceId);
          parameters.resourceId = item.resourceId;
        }
        commandResult = await this.commands.execute(actor, {
          requestId: dto.requestId,
          runId: item.classroomRunId,
          deviceId: dto.deviceId,
          expectedVersion: dto.expectedVersion,
          source: ClassroomCommandSource.AiDirector,
          operation: item.commandOperation as ClassroomCommandOperation,
          targetDeviceId: dto.targetDeviceId,
          parameters,
        });
      }
      item.status = DirectorSuggestionStatus.Confirmed;
      item.confirmedRequestId = dto.requestId;
      await this.suggestions.save(item);
      await this.audit.write(actor, {
        action: 'classroom_director.confirmed', targetType: 'director_suggestion', targetId: id,
        metadata: { classroomRunId: item.classroomRunId, commandOperation: item.commandOperation },
      });
      return { suggestion: this.view(item), commandResult, replayed: false };
    } catch (error) {
      await this.audit.write(actor, {
        action: 'classroom_director.confirm_failed', targetType: 'director_suggestion', targetId: id,
        result: AuditResult.Failure,
        metadata: { classroomRunId: item.classroomRunId, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  private async ownedPending(actor: JwtTeacherPayload, id: number) {
    const item = await this.owned(actor, id);
    if (item.status !== DirectorSuggestionStatus.Pending)
      throw new ConflictException('只能修改或忽略待确认建议');
    return item;
  }

  private async owned(actor: JwtTeacherPayload, id: number) {
    this.requireTeacher(actor);
    const item = await this.suggestions.findOne({ where: { id } });
    if (!item) throw new NotFoundException('课堂导演建议不存在');
    if (item.teacherId !== actor.sub) throw new ForbiddenException('无权操作其他教师的课堂建议');
    await this.runs.get(actor, item.classroomRunId);
    return item;
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('AI课堂导演只能由当前课堂教师使用');
  }

  private parseParameters(value: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }

  private view(item: ClassroomDirectorSuggestion) {
    return {
      id: item.id,
      classroomRunId: item.classroomRunId,
      type: item.type,
      title: item.title,
      content: item.currentContent,
      originalContent: item.originalContent,
      rationale: item.rationale,
      resourceId: item.resourceId,
      commandOperation: item.commandOperation,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
