import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { stat } from 'node:fs/promises';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { LessonPlan } from '../lesson-plans/entities/lesson-plan.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { resolveInside } from '../resources/resource-file.validation';
import { AVATAR_UPLOAD_DIRECTORY } from './avatar-file.validation';
import { AvatarService } from './avatar.service';
import {
  AvatarActionName,
  AvatarAssetType,
  AvatarBindingScope,
  AvatarBindingStatus,
  AvatarCharacterStatus,
  AvatarFallbackLevel,
  AvatarVersionStatus,
  AvatarVoiceStatus,
} from './avatar.types';
import {
  ResolveAvatarQueryDto,
  SetAvatarBindingDto,
  UpsertAvatarPersonalityDto,
  UpsertAvatarVoiceProfileDto,
} from './dto/avatar-config.dto';
import { AvatarAsset } from './entities/avatar-asset.entity';
import { AvatarBinding } from './entities/avatar-binding.entity';
import { AvatarCharacter } from './entities/avatar-character.entity';
import { AvatarConfigHistory } from './entities/avatar-config-history.entity';
import { AvatarPersonality } from './entities/avatar-personality.entity';
import { AvatarUsageLog } from './entities/avatar-usage-log.entity';
import { AvatarVersion } from './entities/avatar-version.entity';
import { AvatarVoiceProfile } from './entities/avatar-voice-profile.entity';

type ResolveContext = {
  classId?: number;
  lessonPlanId?: number;
  classroomRunId?: number;
  pinnedCharacterId?: number | null;
  pinnedVersionId?: number | null;
  requestedAction?: AvatarActionName;
};

type BindingContext = {
  classId: number | null;
  lessonPlanId: number | null;
  classroomRunId: number | null;
};

@Injectable()
export class AvatarConfigurationService {
  constructor(
    @InjectRepository(AvatarVoiceProfile)
    private readonly voices: Repository<AvatarVoiceProfile>,
    @InjectRepository(AvatarPersonality)
    private readonly personalities: Repository<AvatarPersonality>,
    @InjectRepository(AvatarBinding)
    private readonly bindings: Repository<AvatarBinding>,
    @InjectRepository(AvatarConfigHistory)
    private readonly histories: Repository<AvatarConfigHistory>,
    @InjectRepository(AvatarUsageLog)
    private readonly usageLogs: Repository<AvatarUsageLog>,
    @InjectRepository(AvatarCharacter)
    private readonly characters: Repository<AvatarCharacter>,
    @InjectRepository(AvatarVersion)
    private readonly versions: Repository<AvatarVersion>,
    @InjectRepository(AvatarAsset)
    private readonly assets: Repository<AvatarAsset>,
    @InjectRepository(ClassroomRun)
    private readonly runs: Repository<ClassroomRun>,
    @InjectRepository(LessonPlan)
    private readonly lessonPlanRepository: Repository<LessonPlan>,
    private readonly dataSource: DataSource,
    private readonly avatarService: AvatarService,
    private readonly access: PlatformAccessService,
  ) {}

  async upsertVoice(
    actor: JwtTeacherPayload,
    characterId: number,
    dto: UpsertAvatarVoiceProfileDto,
  ) {
    await this.avatarService.requireManageableCharacter(actor, characterId);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AvatarVoiceProfile);
      const before = await repo.findOne({ where: { characterId } });
      const entity = repo.create({
        ...before,
        characterId,
        provider: dto.provider.trim(),
        voiceId: dto.voiceId.trim(),
        language: dto.language.trim(),
        speed: dto.speed,
        volume: dto.volume,
        pitch: dto.pitch,
        status: dto.status,
      });
      const saved = await repo.save(entity);
      await this.writeHistory(manager, actor, {
        characterId,
        reason: dto.reason,
        before: before ? this.voiceResponse(before) : null,
        after: this.voiceResponse(saved),
      });
      return this.voiceResponse(saved);
    });
  }

  async upsertPersonality(
    actor: JwtTeacherPayload,
    characterId: number,
    dto: UpsertAvatarPersonalityDto,
  ) {
    await this.avatarService.requireManageableCharacter(actor, characterId);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AvatarPersonality);
      const before = await repo.findOne({ where: { characterId } });
      const entity = repo.create({
        ...before,
        characterId,
        style: dto.style.trim(),
        catchphrases: JSON.stringify(
          dto.catchphrases.map((item) => item.trim()),
        ),
        greeting: dto.greeting.trim(),
        encouragementStyle: dto.encouragementStyle.trim(),
        goodbyeText: dto.goodbyeText.trim(),
      });
      const saved = await repo.save(entity);
      await this.writeHistory(manager, actor, {
        characterId,
        reason: dto.reason,
        before: before ? this.personalityResponse(before) : null,
        after: this.personalityResponse(saved),
      });
      return this.personalityResponse(saved);
    });
  }

  async setClassBinding(
    actor: JwtTeacherPayload,
    classId: number,
    dto: SetAvatarBindingDto,
  ) {
    await this.access.requireClassAccess(actor, classId);
    return this.setBinding(actor, AvatarBindingScope.Class, classId, dto, {
      classId,
      lessonPlanId: null,
      classroomRunId: null,
    });
  }

  async setLessonBinding(
    actor: JwtTeacherPayload,
    lessonPlanId: number,
    dto: SetAvatarBindingDto,
  ) {
    await this.requireLessonAccess(actor, lessonPlanId);
    return this.setBinding(
      actor,
      AvatarBindingScope.LessonPlan,
      lessonPlanId,
      dto,
      { classId: null, lessonPlanId, classroomRunId: null },
    );
  }

  async setSystemBinding(actor: JwtTeacherPayload, dto: SetAvatarBindingDto) {
    this.access.requireAdministrator(actor);
    return this.setBinding(actor, AvatarBindingScope.System, 0, dto, {
      classId: null,
      lessonPlanId: null,
      classroomRunId: null,
    });
  }

  async cancelClassBinding(
    actor: JwtTeacherPayload,
    classId: number,
    reason: string,
  ) {
    await this.access.requireClassAccess(actor, classId);
    return this.cancelBinding(
      actor,
      AvatarBindingScope.Class,
      classId,
      reason,
      {
        classId,
        lessonPlanId: null,
        classroomRunId: null,
      },
    );
  }

  async cancelLessonBinding(
    actor: JwtTeacherPayload,
    lessonPlanId: number,
    reason: string,
  ) {
    await this.requireLessonAccess(actor, lessonPlanId);
    return this.cancelBinding(
      actor,
      AvatarBindingScope.LessonPlan,
      lessonPlanId,
      reason,
      { classId: null, lessonPlanId, classroomRunId: null },
    );
  }

  async cancelSystemBinding(actor: JwtTeacherPayload, reason: string) {
    this.access.requireAdministrator(actor);
    return this.cancelBinding(actor, AvatarBindingScope.System, 0, reason, {
      classId: null,
      lessonPlanId: null,
      classroomRunId: null,
    });
  }

  async upsertClassroomBinding(
    manager: EntityManager,
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    dto: SetAvatarBindingDto,
  ) {
    return this.setBinding(
      actor,
      AvatarBindingScope.ClassroomRun,
      run.id,
      dto,
      {
        classId: run.classId,
        lessonPlanId: run.lessonPlanId,
        classroomRunId: run.id,
      },
      manager,
    );
  }

  async cancelClassroomBinding(
    manager: EntityManager,
    actor: JwtTeacherPayload,
    run: ClassroomRun,
    reason: string,
  ) {
    return this.cancelBinding(
      actor,
      AvatarBindingScope.ClassroomRun,
      run.id,
      reason,
      {
        classId: run.classId,
        lessonPlanId: run.lessonPlanId,
        classroomRunId: run.id,
      },
      manager,
    );
  }

  async validateBindingTarget(
    actor: JwtTeacherPayload,
    characterId: number,
    versionId: number,
    manager?: EntityManager,
  ) {
    const result = await this.avatarService.requireReadyForClassroom(
      actor,
      versionId,
      manager,
    );
    if (result.character.id !== characterId)
      throw new ConflictException('数字人版本不属于指定角色');
    return result;
  }

  async resolve(actor: JwtTeacherPayload, query: ResolveAvatarQueryDto) {
    const context = await this.authorizedContext(actor, query);
    return this.resolveContext(actor, {
      ...context,
      requestedAction: query.actionName,
    });
  }

  async resolveContext(actor: JwtTeacherPayload, context: ResolveContext) {
    const candidates = await this.bindingCandidates(context);
    const system = candidates.find(
      (item) => item.scopeType === AvatarBindingScope.System,
    );
    const preferred = candidates.filter(
      (item) => item.scopeType !== AvatarBindingScope.System,
    );
    const requestedCharacterId =
      preferred[0]?.characterId ?? system?.characterId ?? null;
    const reasons: string[] = [];
    let systemFallback = false;

    for (const candidate of [...preferred, ...(system ? [system] : [])]) {
      const available = await this.loadAvailable(actor, candidate);
      if (!available) {
        reasons.push(
          `绑定角色${candidate.characterId}或版本${candidate.versionId}不可用`,
        );
        if (candidate.scopeType !== AvatarBindingScope.System)
          systemFallback = true;
        continue;
      }
      const result = await this.buildResolved(
        actor,
        context,
        candidate,
        available.character,
        available.version,
        available.assets,
        available.render,
        reasons,
        systemFallback,
        requestedCharacterId,
      );
      return result;
    }

    const result = {
      sourceScope: null,
      character: null,
      version: null,
      renderAsset: null,
      action: {
        requested: context.requestedAction ?? AvatarActionName.Idle,
        effective: null,
        contentUrl: null,
      },
      voice: this.defaultVoice(),
      personality: null,
      fallbackLevel: AvatarFallbackLevel.SafeMode,
      reason: [
        ...reasons,
        '没有可用的系统默认角色，前端应使用内置安全占位形象',
      ].join('；'),
    };
    await this.writeUsage(actor, context, requestedCharacterId, result);
    return result;
  }

  async resolveVersionReference(
    actor: JwtTeacherPayload,
    context: ResolveContext,
    manager?: EntityManager,
  ): Promise<{ characterId: number; versionId: number } | null> {
    // 兼容尚未执行任务7迁移的旧测试库和滚动升级节点。
    if (!this.dataSource.hasMetadata(AvatarBinding)) return null;
    const repository = manager?.getRepository(AvatarBinding) ?? this.bindings;
    const versionRepository =
      manager?.getRepository(AvatarVersion) ?? this.versions;
    const characterRepository =
      manager?.getRepository(AvatarCharacter) ?? this.characters;
    const targets: Array<[AvatarBindingScope, number]> = [];
    if (context.classroomRunId)
      targets.push([AvatarBindingScope.ClassroomRun, context.classroomRunId]);
    if (context.lessonPlanId)
      targets.push([AvatarBindingScope.LessonPlan, context.lessonPlanId]);
    if (context.classId)
      targets.push([AvatarBindingScope.Class, context.classId]);
    targets.push([AvatarBindingScope.System, 0]);
    for (const [scopeType, scopeId] of targets) {
      const binding = await repository.findOne({
        where: { scopeType, scopeId, status: AvatarBindingStatus.Active },
        order: { id: 'DESC' },
      });
      if (!binding) continue;
      const [character, version] = await Promise.all([
        characterRepository.findOne({ where: { id: binding.characterId } }),
        versionRepository.findOne({ where: { id: binding.versionId } }),
      ]);
      if (
        character?.status === AvatarCharacterStatus.Approved &&
        version?.status === AvatarVersionStatus.Ready &&
        version.characterId === character.id
      ) {
        try {
          await this.avatarService.requireReadyForClassroom(
            actor,
            version.id,
            manager,
          );
          return { characterId: character.id, versionId: version.id };
        } catch (error) {
          if (error instanceof ForbiddenException) throw error;
        }
      }
    }
    return null;
  }

  private async setBinding(
    actor: JwtTeacherPayload,
    scopeType: AvatarBindingScope,
    scopeId: number,
    dto: SetAvatarBindingDto,
    context: BindingContext,
    manager?: EntityManager,
  ) {
    await this.validateBindingTarget(
      actor,
      dto.characterId,
      dto.versionId,
      manager,
    );
    const execute = async (tx: EntityManager) => {
      const repo = tx.getRepository(AvatarBinding);
      const before = await repo.findOne({
        where: { scopeType, scopeId, status: AvatarBindingStatus.Active },
      });
      if (before) {
        before.status = AvatarBindingStatus.Cancelled;
        before.cancelledAt = new Date();
        await repo.save(before);
      }
      const saved = await repo.save(
        repo.create({
          scopeType,
          scopeId,
          characterId: dto.characterId,
          versionId: dto.versionId,
          createdBy: actor.sub,
          status: AvatarBindingStatus.Active,
          cancelledAt: null,
        }),
      );
      await this.writeHistory(tx, actor, {
        characterId: dto.characterId,
        scopeType,
        scopeId,
        reason: dto.reason,
        before: before ? this.bindingResponse(before) : null,
        after: this.bindingResponse(saved),
        ...context,
      });
      return this.bindingResponse(saved);
    };
    return manager ? execute(manager) : this.dataSource.transaction(execute);
  }

  private async cancelBinding(
    actor: JwtTeacherPayload,
    scopeType: AvatarBindingScope,
    scopeId: number,
    reason: string,
    context: BindingContext,
    manager?: EntityManager,
  ) {
    const execute = async (tx: EntityManager) => {
      const repo = tx.getRepository(AvatarBinding);
      const binding = await repo.findOne({
        where: { scopeType, scopeId, status: AvatarBindingStatus.Active },
      });
      if (!binding) throw new NotFoundException('当前层级没有有效数字人绑定');
      binding.status = AvatarBindingStatus.Cancelled;
      binding.cancelledAt = new Date();
      await repo.save(binding);
      await this.writeHistory(tx, actor, {
        characterId: binding.characterId,
        scopeType,
        scopeId,
        reason,
        before: this.bindingResponse(binding, AvatarBindingStatus.Active),
        after: null,
        ...context,
      });
      return { cancelled: true, id: binding.id };
    };
    return manager ? execute(manager) : this.dataSource.transaction(execute);
  }

  private async authorizedContext(
    actor: JwtTeacherPayload,
    query: ResolveAvatarQueryDto,
  ): Promise<ResolveContext> {
    if (query.classroomRunId) {
      const run = await this.runs.findOne({
        where: { id: query.classroomRunId },
      });
      if (!run) throw new NotFoundException('课堂运行不存在');
      if (run.teacherId !== actor.sub)
        throw new ForbiddenException('无权读取其他教师的课堂数字人');
      await this.access.requireClassAccess(actor, run.classId);
      if (query.deviceId && run.deviceId !== query.deviceId)
        throw new ForbiddenException('当前设备已失去课堂控制权');
      return {
        classroomRunId: run.id,
        classId: run.classId,
        lessonPlanId: run.lessonPlanId,
        pinnedCharacterId: run.avatarCharacterId,
        pinnedVersionId: run.avatarVersionId,
      };
    }
    if (query.classId)
      await this.access.requireClassAccess(actor, query.classId);
    if (query.lessonPlanId)
      await this.requireLessonAccess(actor, query.lessonPlanId);
    return { classId: query.classId, lessonPlanId: query.lessonPlanId };
  }

  private async bindingCandidates(context: ResolveContext) {
    const targets: Array<[AvatarBindingScope, number]> = [];
    const result: AvatarBinding[] = [];
    if (context.classroomRunId) {
      const classroomBinding = await this.bindings.findOne({
        where: {
          scopeType: AvatarBindingScope.ClassroomRun,
          scopeId: context.classroomRunId,
          status: AvatarBindingStatus.Active,
        },
        order: { id: 'DESC' },
      });
      if (classroomBinding) result.push(classroomBinding);
      else if (context.pinnedCharacterId && context.pinnedVersionId)
        result.push(
          this.bindings.create({
            id: 0,
            scopeType: AvatarBindingScope.ClassroomRun,
            scopeId: context.classroomRunId,
            characterId: context.pinnedCharacterId,
            versionId: context.pinnedVersionId,
            createdBy: 0,
            status: AvatarBindingStatus.Active,
            cancelledAt: null,
          }),
        );
    }
    if (context.lessonPlanId)
      targets.push([AvatarBindingScope.LessonPlan, context.lessonPlanId]);
    if (context.classId)
      targets.push([AvatarBindingScope.Class, context.classId]);
    targets.push([AvatarBindingScope.System, 0]);
    for (const [scopeType, scopeId] of targets) {
      const binding = await this.bindings.findOne({
        where: { scopeType, scopeId, status: AvatarBindingStatus.Active },
        order: { id: 'DESC' },
      });
      if (binding) result.push(binding);
    }
    return result;
  }

  private async loadAvailable(
    actor: JwtTeacherPayload,
    binding: AvatarBinding,
  ) {
    const [character, version, assets] = await Promise.all([
      this.characters.findOne({ where: { id: binding.characterId } }),
      this.versions.findOne({ where: { id: binding.versionId } }),
      this.assets.find({
        where: { versionId: binding.versionId },
        order: { id: 'ASC' },
      }),
    ]);
    if (
      !character ||
      !version ||
      version.characterId !== character.id ||
      character.status !== AvatarCharacterStatus.Approved ||
      version.status !== AvatarVersionStatus.Ready
    )
      return null;
    try {
      await this.avatarService.requireReadyForClassroom(actor, version.id);
    } catch {
      return null;
    }
    const model = await this.firstAvailable(
      assets.filter((asset) => asset.assetType === AvatarAssetType.Model),
    );
    const fallback2d = await this.firstAvailable(
      assets.filter((asset) => asset.assetType === AvatarAssetType.Fallback2d),
    );
    const render = model ?? fallback2d;
    if (!render) return null;
    return { character, version, assets, render };
  }

  private async buildResolved(
    actor: JwtTeacherPayload,
    context: ResolveContext,
    binding: AvatarBinding,
    character: AvatarCharacter,
    version: AvatarVersion,
    assets: AvatarAsset[],
    initialRender: AvatarAsset,
    inheritedReasons: string[],
    systemFallback: boolean,
    requestedCharacterId: number | null,
  ) {
    const reasons = [...inheritedReasons];
    let level = systemFallback
      ? AvatarFallbackLevel.SystemCharacter
      : AvatarFallbackLevel.None;
    const model = await this.firstAvailable(
      assets.filter((asset) => asset.assetType === AvatarAssetType.Model),
    );
    const render = model ?? initialRender;
    if (render.assetType === AvatarAssetType.Fallback2d) {
      reasons.push('主3D模型不可用，已使用2D备用角色');
      level = this.higher(level, AvatarFallbackLevel.Model2d);
    }

    const requested = context.requestedAction ?? AvatarActionName.Idle;
    let actionAsset = await this.firstAvailable(
      assets.filter(
        (asset) =>
          asset.assetType === AvatarAssetType.Animation &&
          asset.actionName === requested,
      ),
    );
    let effectiveAction: AvatarActionName | null = requested;
    if (!actionAsset) {
      for (const fallback of [AvatarActionName.Idle, AvatarActionName.Speak]) {
        actionAsset = await this.firstAvailable(
          assets.filter(
            (asset) =>
              asset.assetType === AvatarAssetType.Animation &&
              asset.actionName === fallback,
          ),
        );
        if (actionAsset) {
          effectiveAction = fallback;
          break;
        }
      }
      reasons.push(
        `动作${requested}不可用，已回退到${effectiveAction ?? '静态形象'}`,
      );
      level = this.higher(level, AvatarFallbackLevel.Action);
    }

    const voice = await this.voices.findOne({
      where: { characterId: character.id },
    });
    const effectiveVoice =
      voice?.status === AvatarVoiceStatus.Active
        ? this.voiceResponse(voice)
        : this.defaultVoice();
    if (!voice || voice.status !== AvatarVoiceStatus.Active) {
      reasons.push('指定音色不可用，已使用系统默认音色');
      level = this.higher(level, AvatarFallbackLevel.Voice);
    }
    const personality = await this.personalities.findOne({
      where: { characterId: character.id },
    });
    const result = {
      sourceScope: binding.scopeType,
      character: {
        id: character.id,
        name: character.name,
        category: character.category,
      },
      version: {
        id: version.id,
        version: version.version,
        engineVersion: version.engineVersion,
        modelFormat: version.modelFormat,
      },
      renderAsset: this.assetResponse(render),
      action: {
        requested,
        effective: effectiveAction,
        contentUrl: actionAsset
          ? `/avatars/assets/${actionAsset.id}/content`
          : null,
      },
      voice: effectiveVoice,
      personality: personality ? this.personalityResponse(personality) : null,
      fallbackLevel: level,
      reason: reasons.length ? reasons.join('；') : null,
    };
    if (level !== AvatarFallbackLevel.None)
      await this.writeUsage(actor, context, requestedCharacterId, result);
    return result;
  }

  private async firstAvailable(assets: AvatarAsset[]) {
    for (const asset of assets) {
      const path = resolveInside(AVATAR_UPLOAD_DIRECTORY, asset.filePath);
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && info.size === asset.fileSize) return asset;
    }
    return null;
  }

  private higher(current: AvatarFallbackLevel, next: AvatarFallbackLevel) {
    const rank: Record<AvatarFallbackLevel, number> = {
      [AvatarFallbackLevel.None]: 0,
      [AvatarFallbackLevel.Action]: 1,
      [AvatarFallbackLevel.Voice]: 2,
      [AvatarFallbackLevel.Model2d]: 3,
      [AvatarFallbackLevel.SystemCharacter]: 4,
      [AvatarFallbackLevel.SafeMode]: 5,
    };
    return rank[next] > rank[current] ? next : current;
  }

  private defaultVoice() {
    return {
      provider: process.env.AVATAR_DEFAULT_VOICE_PROVIDER || 'system',
      voiceId: process.env.AVATAR_DEFAULT_VOICE_ID || 'default-child-safe',
      language: process.env.AVATAR_DEFAULT_VOICE_LANGUAGE || 'zh-CN',
      speed: 1,
      volume: 1,
      pitch: 0,
      status: AvatarVoiceStatus.Active,
      isSystemDefault: true,
    };
  }

  private async writeUsage(
    actor: JwtTeacherPayload,
    context: ResolveContext,
    requestedCharacterId: number | null,
    result: {
      sourceScope: AvatarBindingScope | null;
      character: { id: number } | null;
      version: { id: number } | null;
      action: {
        requested: AvatarActionName;
        effective: AvatarActionName | null;
      };
      fallbackLevel: AvatarFallbackLevel;
      reason: string | null;
    },
  ) {
    try {
      await this.usageLogs.save(
        this.usageLogs.create({
          classroomRunId: context.classroomRunId ?? null,
          teacherId: actor.userType === AuthUserType.Teacher ? actor.sub : null,
          sourceScope: result.sourceScope,
          requestedCharacterId,
          effectiveCharacterId: result.character?.id ?? null,
          effectiveVersionId: result.version?.id ?? null,
          requestedAction: result.action.requested,
          effectiveAction: result.action.effective,
          fallbackLevel: result.fallbackLevel,
          reason: result.reason,
          detail: JSON.stringify({
            classId: context.classId,
            lessonPlanId: context.lessonPlanId,
          }),
        }),
      );
    } catch {
      // 回退日志失败不得导致课堂接口整体失败。
    }
  }

  private async writeHistory(
    manager: EntityManager,
    actor: JwtTeacherPayload,
    input: {
      characterId: number | null;
      scopeType?: AvatarBindingScope;
      scopeId?: number;
      reason: string;
      before: unknown;
      after: unknown;
      classId?: number | null;
      lessonPlanId?: number | null;
      classroomRunId?: number | null;
    },
  ) {
    await manager.getRepository(AvatarConfigHistory).save(
      manager.getRepository(AvatarConfigHistory).create({
        characterId: input.characterId,
        scopeType: input.scopeType ?? null,
        scopeId: input.scopeId ?? null,
        operatorType: actor.userType,
        operatorId: actor.sub,
        beforeSummary:
          input.before == null ? null : JSON.stringify(input.before),
        afterSummary: input.after == null ? null : JSON.stringify(input.after),
        reason: input.reason.trim(),
        classId: input.classId ?? null,
        lessonPlanId: input.lessonPlanId ?? null,
        classroomRunId: input.classroomRunId ?? null,
      }),
    );
  }

  private async requireLessonAccess(
    actor: JwtTeacherPayload,
    lessonPlanId: number,
  ) {
    const plan = await this.lessonPlanRepository.findOne({
      where: { id: lessonPlanId, deletedAt: IsNull() },
    });
    if (!plan) throw new NotFoundException('教案不存在');
    if (!this.access.isAdministrator(actor) && plan.teacherId !== actor.sub)
      throw new ForbiddenException('无权访问该教案');
    if (actor.schoolId && plan.schoolId && actor.schoolId !== plan.schoolId)
      throw new ForbiddenException('无权访问其他园所教案');
    return plan;
  }

  private voiceResponse(value: AvatarVoiceProfile) {
    return {
      id: value.id,
      characterId: value.characterId,
      provider: value.provider,
      voiceId: value.voiceId,
      language: value.language,
      speed: value.speed,
      volume: value.volume,
      pitch: value.pitch,
      status: value.status,
      isSystemDefault: false,
    };
  }

  private personalityResponse(value: AvatarPersonality) {
    let catchphrases: string[] = [];
    try {
      const parsed: unknown = JSON.parse(value.catchphrases);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
      )
        catchphrases = parsed;
    } catch {
      catchphrases = [];
    }
    return {
      id: value.id,
      characterId: value.characterId,
      style: value.style,
      catchphrases,
      greeting: value.greeting,
      encouragementStyle: value.encouragementStyle,
      goodbyeText: value.goodbyeText,
    };
  }

  private bindingResponse(value: AvatarBinding, status = value.status) {
    return {
      id: value.id,
      scopeType: value.scopeType,
      scopeId: value.scopeId,
      characterId: value.characterId,
      versionId: value.versionId,
      status,
      createdBy: value.createdBy,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  private assetResponse(asset: AvatarAsset) {
    return {
      id: asset.id,
      assetType: asset.assetType,
      mimeType: asset.mimeType,
      checksum: asset.checksum,
      contentUrl: `/avatars/assets/${asset.id}/content`,
    };
  }
}
