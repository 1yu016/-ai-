import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { TeacherRole } from '../auth/entities/teacher.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { ClassroomSnapshot } from '../classroom-runs/entities/classroom-snapshot.entity';
import { AuditService } from '../platform/audit.service';
import { ACTIVE_CLASSROOM_RUN_STATUSES } from '../classroom-runs/classroom-run.types';
import {
  AVATAR_UPLOAD_DIRECTORY,
  modelFormatForExtension,
  parseSafeJsonObject,
  validateAvatarFile,
} from './avatar-file.validation';
import {
  AvatarAssetType,
  AvatarCharacterStatus,
  type AvatarIntegrityIssue,
  AvatarVersionStatus,
  REQUIRED_AVATAR_ACTIONS,
} from './avatar.types';
import {
  CreateAvatarCharacterDto,
  CreateAvatarVersionDto,
  DisableAvatarVersionDto,
  ListAvatarCharacterQueryDto,
  ReviewAvatarCharacterDto,
  UpdateAvatarCharacterDto,
  UploadAvatarAssetDto,
} from './dto/avatar.dto';
import { AvatarAsset } from './entities/avatar-asset.entity';
import { AvatarCharacter } from './entities/avatar-character.entity';
import { AvatarPersonality } from './entities/avatar-personality.entity';
import { AvatarVersion } from './entities/avatar-version.entity';
import { AvatarVoiceProfile } from './entities/avatar-voice-profile.entity';
import { resolveInside } from '../resources/resource-file.validation';

type AvatarIntegrityResult = {
  valid: boolean;
  issues: AvatarIntegrityIssue[];
  calculatedChecksum: string | null;
};

type QuarantinedFile = { original: string; quarantined: string };

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly supportedEngineVersions: Set<string>;

  constructor(
    @InjectRepository(AvatarCharacter)
    private readonly characters: Repository<AvatarCharacter>,
    @InjectRepository(AvatarVersion)
    private readonly versions: Repository<AvatarVersion>,
    @InjectRepository(AvatarAsset)
    private readonly assets: Repository<AvatarAsset>,
    @InjectRepository(AvatarVoiceProfile)
    private readonly voices: Repository<AvatarVoiceProfile>,
    @InjectRepository(AvatarPersonality)
    private readonly personalities: Repository<AvatarPersonality>,
    @InjectRepository(ClassroomRun)
    private readonly classroomRuns: Repository<ClassroomRun>,
    @InjectRepository(ClassroomSnapshot)
    private readonly classroomSnapshots: Repository<ClassroomSnapshot>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.supportedEngineVersions = new Set(
      (
        this.config.get<string>('AVATAR_SUPPORTED_ENGINE_VERSIONS') ||
        'avatar-engine-1'
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }

  async createCharacter(
    actor: JwtTeacherPayload,
    dto: CreateAvatarCharacterDto,
  ) {
    const character = await this.characters.save(
      this.characters.create({
        name: dto.name.trim(),
        category: dto.category,
        description: dto.description?.trim() || null,
        ownerType: actor.userType,
        ownerId: actor.sub,
        schoolId: actor.schoolId ?? null,
        status: AvatarCharacterStatus.Draft,
        currentVersionId: null,
      }),
    );
    await this.audit.write(actor, {
      action: 'avatar.character.create',
      targetType: 'avatar_character',
      targetId: character.id,
    });
    return this.characterResponse(character, []);
  }

  async list(actor: JwtTeacherPayload, query: ListAvatarCharacterQueryDto) {
    const builder = this.characters.createQueryBuilder('character');
    if (!this.isAdmin(actor)) {
      builder.andWhere(
        '((character.owner_type = :ownerType AND character.owner_id = :ownerId) OR (character.status = :approved AND character.school_id = :schoolId))',
        {
          ownerType: actor.userType,
          ownerId: actor.sub,
          approved: AvatarCharacterStatus.Approved,
          schoolId: actor.schoolId ?? '__none__',
        },
      );
    } else if (actor.schoolId) {
      builder.andWhere('character.school_id = :schoolId', {
        schoolId: actor.schoolId,
      });
    }
    if (query.category)
      builder.andWhere('character.category = :category', {
        category: query.category,
      });
    if (query.status)
      builder.andWhere('character.status = :status', { status: query.status });
    const [items, total] = await builder
      .orderBy('character.updated_at', 'DESC')
      .addOrderBy('character.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return {
      items: items.map((character) => this.characterSummary(character)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(actor: JwtTeacherPayload, id: number) {
    const character = await this.findAccessible(actor, id);
    const [versions, voice, personality] = await Promise.all([
      this.versions.find({
        where: { characterId: id },
        order: { version: 'DESC' },
      }),
      this.voices.findOne({ where: { characterId: id } }),
      this.personalities.findOne({ where: { characterId: id } }),
    ]);
    const assets = versions.length
      ? await this.assets.find({
          where: { versionId: In(versions.map((item) => item.id)) },
          order: { id: 'ASC' },
        })
      : [];
    return {
      ...this.characterResponse(character, versions, assets),
      voiceProfile: voice
        ? {
            provider: voice.provider,
            voiceId: voice.voiceId,
            language: voice.language,
            speed: voice.speed,
            volume: voice.volume,
            pitch: voice.pitch,
            status: voice.status,
          }
        : null,
      personality: personality
        ? {
            style: personality.style,
            catchphrases: this.parseStringArray(personality.catchphrases),
            greeting: personality.greeting,
            encouragementStyle: personality.encouragementStyle,
            goodbyeText: personality.goodbyeText,
          }
        : null,
    };
  }

  async updateCharacter(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateAvatarCharacterDto,
  ) {
    const character = await this.findManageable(actor, id);
    if (character.status === AvatarCharacterStatus.Disabled)
      throw new ConflictException('已停用角色不能编辑');
    if (dto.name !== undefined) character.name = dto.name.trim();
    if (dto.category !== undefined) character.category = dto.category;
    if (dto.description !== undefined)
      character.description = dto.description.trim() || null;
    if (character.status !== AvatarCharacterStatus.Draft)
      character.status = AvatarCharacterStatus.Draft;
    const saved = await this.characters.save(character);
    await this.audit.write(actor, {
      action: 'avatar.character.update',
      targetType: 'avatar_character',
      targetId: id,
    });
    return this.get(actor, saved.id);
  }

  async createVersion(
    actor: JwtTeacherPayload,
    characterId: number,
    dto: CreateAvatarVersionDto,
    file?: Express.Multer.File,
  ) {
    try {
      const character = await this.findManageable(actor, characterId);
      if (character.status === AvatarCharacterStatus.Disabled)
        throw new ConflictException('已停用角色不能创建版本');
      const compatibility = parseSafeJsonObject(
        dto.compatibility,
        'compatibility',
      );
      const validation = await validateAvatarFile(
        file,
        AvatarAssetType.Model,
        dto.modelFormat,
      );
      const uploaded = file!;
      const checksum = await this.hashFile(uploaded.path);
      const version = await this.dataSource.transaction(async (manager) => {
        const versionRepo = manager.getRepository(AvatarVersion);
        const assetRepo = manager.getRepository(AvatarAsset);
        const latest = await versionRepo.maximum('version', { characterId });
        const created = await versionRepo.save(
          versionRepo.create({
            characterId,
            version: (latest ?? 0) + 1,
            engineVersion: dto.engineVersion,
            modelFormat: dto.modelFormat,
            checksum: null,
            status: AvatarVersionStatus.Draft,
            compatibility: JSON.stringify(compatibility),
          }),
        );
        await assetRepo.save(
          assetRepo.create({
            versionId: created.id,
            assetType: AvatarAssetType.Model,
            actionName: null,
            originalName: uploaded.originalname,
            filePath: uploaded.filename,
            mimeType: validation.mimeType,
            fileSize: uploaded.size,
            checksum,
            metadata: '{}',
          }),
        );
        return created;
      });
      await this.audit.write(actor, {
        action: 'avatar.version.create',
        targetType: 'avatar_version',
        targetId: version.id,
        metadata: { characterId, version: version.version, checksum },
      });
      return this.versionResponse(
        version,
        await this.assets.find({ where: { versionId: version.id } }),
      );
    } catch (error) {
      if (file?.path) await this.safeUnlink(file.path);
      if (this.isUniqueViolation(error))
        throw new ConflictException('角色版本已变化，请刷新后重试');
      throw error;
    }
  }

  async uploadAsset(
    actor: JwtTeacherPayload,
    versionId: number,
    dto: UploadAvatarAssetDto,
    file?: Express.Multer.File,
  ) {
    try {
      const { version } = await this.findManageableVersion(actor, versionId);
      if (version.status !== AvatarVersionStatus.Draft)
        throw new ConflictException('只有草稿版本可以新增资源');
      if (dto.assetType === AvatarAssetType.Model)
        throw new ConflictException('更新主模型必须创建新版本');
      this.validateActionMapping(dto);
      const metadata = parseSafeJsonObject(dto.metadata, 'metadata');
      const validation = await validateAvatarFile(file, dto.assetType);
      const uploaded = file!;
      const checksum = await this.hashFile(uploaded.path);
      if (this.isSingletonAsset(dto.assetType)) {
        const exists = await this.assets.exists({
          where: { versionId, assetType: dto.assetType },
        });
        if (exists) throw new ConflictException('该版本已存在同类型资源');
      }
      if (dto.assetType === AvatarAssetType.Animation) {
        const exists = await this.assets.exists({
          where: {
            versionId,
            assetType: AvatarAssetType.Animation,
            actionName: dto.actionName,
          },
        });
        if (exists) throw new ConflictException('该动作已绑定动画资源');
      }
      const asset = await this.assets.save(
        this.assets.create({
          versionId,
          assetType: dto.assetType,
          actionName:
            dto.assetType === AvatarAssetType.Animation
              ? (dto.actionName ?? null)
              : null,
          originalName: uploaded.originalname,
          filePath: uploaded.filename,
          mimeType: validation.mimeType,
          fileSize: uploaded.size,
          checksum,
          metadata: JSON.stringify(metadata),
        }),
      );
      await this.audit.write(actor, {
        action: 'avatar.asset.upload',
        targetType: 'avatar_asset',
        targetId: asset.id,
        metadata: {
          versionId,
          assetType: asset.assetType,
          actionName: asset.actionName,
          fileSize: asset.fileSize,
          checksum,
        },
      });
      return this.assetResponse(asset);
    } catch (error) {
      if (file?.path) await this.safeUnlink(file.path);
      throw error;
    }
  }

  async checkIntegrity(
    actor: JwtTeacherPayload,
    versionId: number,
  ): Promise<AvatarIntegrityResult> {
    await this.findManageableVersion(actor, versionId);
    return this.performIntegrityCheck(versionId);
  }

  async publishVersion(actor: JwtTeacherPayload, versionId: number) {
    const { version, character } = await this.findManageableVersion(
      actor,
      versionId,
    );
    if (version.status === AvatarVersionStatus.Disabled)
      throw new ConflictException('已停用版本不能发布');
    const integrity = await this.performIntegrityCheck(versionId);
    if (!integrity.valid)
      throw new ConflictException({
        message: '数字人版本完整性检查未通过',
        issues: integrity.issues,
      });
    const saved = await this.dataSource.transaction(async (manager) => {
      const versionRepo = manager.getRepository(AvatarVersion);
      const characterRepo = manager.getRepository(AvatarCharacter);
      version.status = AvatarVersionStatus.Ready;
      version.checksum = integrity.calculatedChecksum;
      const ready = await versionRepo.save(version);
      character.currentVersionId = ready.id;
      await characterRepo.save(character);
      return ready;
    });
    await this.audit.write(actor, {
      action: 'avatar.version.publish',
      targetType: 'avatar_version',
      targetId: versionId,
      metadata: { checksum: saved.checksum },
    });
    return this.versionResponse(
      saved,
      await this.assets.find({ where: { versionId } }),
    );
  }

  async submitReview(actor: JwtTeacherPayload, characterId: number) {
    const character = await this.findManageable(actor, characterId);
    if (!character.currentVersionId)
      throw new ConflictException('角色没有可审核的ready版本');
    const version = await this.versions.findOne({
      where: { id: character.currentVersionId, characterId },
    });
    if (!version || version.status !== AvatarVersionStatus.Ready)
      throw new ConflictException('角色当前版本尚未ready');
    character.status = AvatarCharacterStatus.Pending;
    await this.characters.save(character);
    await this.audit.write(actor, {
      action: 'avatar.character.review.submit',
      targetType: 'avatar_character',
      targetId: characterId,
    });
    return this.get(actor, characterId);
  }

  async reviewCharacter(
    actor: JwtTeacherPayload,
    characterId: number,
    dto: ReviewAvatarCharacterDto,
  ) {
    this.requireAdmin(actor);
    if (
      ![
        AvatarCharacterStatus.Approved,
        AvatarCharacterStatus.Rejected,
        AvatarCharacterStatus.Disabled,
      ].includes(dto.status)
    )
      throw new BadRequestException('审核状态不合法');
    const character = await this.findManageable(actor, characterId);
    if (
      dto.status !== AvatarCharacterStatus.Disabled &&
      character.status !== AvatarCharacterStatus.Pending
    )
      throw new ConflictException('角色尚未提交审核');
    character.status = dto.status;
    if (dto.status === AvatarCharacterStatus.Disabled)
      character.currentVersionId = null;
    await this.characters.save(character);
    await this.audit.write(actor, {
      action: 'avatar.character.review',
      targetType: 'avatar_character',
      targetId: characterId,
      metadata: { status: dto.status, comment: dto.comment?.trim() },
    });
    return this.get(actor, characterId);
  }

  async setVersionStatus(
    actor: JwtTeacherPayload,
    versionId: number,
    dto: DisableAvatarVersionDto,
  ) {
    this.requireAdmin(actor);
    if (dto.status !== AvatarVersionStatus.Disabled)
      throw new BadRequestException('管理员接口只允许停用版本');
    const { version, character } = await this.findManageableVersion(
      actor,
      versionId,
    );
    version.status = AvatarVersionStatus.Disabled;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(AvatarVersion).save(version);
      if (character.currentVersionId === versionId) {
        character.currentVersionId = null;
        await manager.getRepository(AvatarCharacter).save(character);
      }
    });
    await this.audit.write(actor, {
      action: 'avatar.version.disable',
      targetType: 'avatar_version',
      targetId: versionId,
      metadata: { reason: dto.reason?.trim() },
    });
    return this.versionResponse(
      version,
      await this.assets.find({ where: { versionId } }),
    );
  }

  async removeVersion(actor: JwtTeacherPayload, versionId: number) {
    const { version, character } = await this.findManageableVersion(
      actor,
      versionId,
    );
    if (character.currentVersionId === versionId)
      throw new ConflictException('当前角色版本不能删除，请先发布其他版本');
    const [activeRuns, snapshots] = await Promise.all([
      this.classroomRuns.count({
        where: {
          avatarVersionId: versionId,
          status: In([...ACTIVE_CLASSROOM_RUN_STATUSES]),
        },
      }),
      this.classroomSnapshots.count({ where: { avatarVersionId: versionId } }),
    ]);
    if (activeRuns || snapshots)
      throw new ConflictException({
        message: '数字人版本正在被课堂快照使用，不能物理删除',
        activeRunCount: activeRuns,
        snapshotCount: snapshots,
      });
    const assets = await this.assets.find({ where: { versionId } });
    const quarantined = await this.quarantineFiles(assets);
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(AvatarAsset).delete({ versionId });
        await manager.getRepository(AvatarVersion).delete({ id: versionId });
      });
    } catch (error) {
      await this.restoreQuarantined(quarantined);
      throw error;
    }
    for (const file of quarantined)
      await unlink(file.quarantined).catch((error) =>
        this.logger.error(
          `数字人隔离文件清理失败：${file.quarantined} ${String(error)}`,
        ),
      );
    await this.audit.write(actor, {
      action: 'avatar.version.delete',
      targetType: 'avatar_version',
      targetId: versionId,
      metadata: { characterId: version.characterId, assetCount: assets.length },
    });
    return { deleted: true };
  }

  async downloadAsset(actor: JwtTeacherPayload, assetId: number) {
    const asset = await this.assets.findOne({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('数字人资源不存在');
    const version = await this.versions.findOne({
      where: { id: asset.versionId },
    });
    if (!version) throw new NotFoundException('数字人版本不存在');
    await this.findAccessible(actor, version.characterId);
    const path = resolveInside(AVATAR_UPLOAD_DIRECTORY, asset.filePath);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('数字人资源文件不存在');
    return {
      path,
      size: info.size,
      mimeType: asset.mimeType,
      fileName: asset.originalName,
    };
  }

  async requireReadyForClassroom(
    actor: JwtTeacherPayload,
    versionId: number,
    manager?: EntityManager,
  ) {
    const versionRepo = manager?.getRepository(AvatarVersion) ?? this.versions;
    const characterRepo =
      manager?.getRepository(AvatarCharacter) ?? this.characters;
    const version = await versionRepo.findOne({ where: { id: versionId } });
    if (!version) throw new NotFoundException('数字人版本不存在');
    if (version.status !== AvatarVersionStatus.Ready)
      throw new ConflictException('数字人版本尚未ready');
    const character = await characterRepo.findOne({
      where: { id: version.characterId },
    });
    if (!character) throw new NotFoundException('数字人角色不存在');
    if (character.status !== AvatarCharacterStatus.Approved)
      throw new ConflictException('数字人角色尚未审核通过');
    this.assertAccessible(actor, character);
    return { character, version };
  }

  async requireManageableCharacter(
    actor: JwtTeacherPayload,
    characterId: number,
  ) {
    return this.findManageable(actor, characterId);
  }

  private async performIntegrityCheck(
    versionId: number,
  ): Promise<AvatarIntegrityResult> {
    const version = await this.versions.findOne({ where: { id: versionId } });
    if (!version) throw new NotFoundException('数字人版本不存在');
    const assets = await this.assets.find({
      where: { versionId },
      order: { id: 'ASC' },
    });
    const issues: AvatarIntegrityIssue[] = [];
    const byType = (type: AvatarAssetType) =>
      assets.filter((asset) => asset.assetType === type);
    if (byType(AvatarAssetType.Model).length !== 1)
      issues.push({
        code: 'MODEL_REQUIRED',
        message: '必须且只能有一个主模型',
      });
    if (!byType(AvatarAssetType.Texture).length)
      issues.push({ code: 'TEXTURE_REQUIRED', message: '缺少必要贴图' });
    for (const action of REQUIRED_AVATAR_ACTIONS)
      if (
        !assets.some(
          (asset) =>
            asset.assetType === AvatarAssetType.Animation &&
            asset.actionName === action,
        )
      )
        issues.push({
          code: `ACTION_${action.toUpperCase()}_REQUIRED`,
          message: `缺少${action}动作`,
        });
    if (!byType(AvatarAssetType.LipSync).length)
      issues.push({ code: 'LIP_SYNC_REQUIRED', message: '缺少口型资源或配置' });
    if (!byType(AvatarAssetType.Preview).length)
      issues.push({ code: 'PREVIEW_REQUIRED', message: '缺少预览图' });
    if (!byType(AvatarAssetType.Fallback2d).length)
      issues.push({ code: 'FALLBACK_2D_REQUIRED', message: '缺少2D备用资源' });
    if (!this.supportedEngineVersions.has(version.engineVersion))
      issues.push({
        code: 'ENGINE_VERSION_INCOMPATIBLE',
        message: `不兼容的引擎版本：${version.engineVersion}`,
      });
    const model = byType(AvatarAssetType.Model)[0];
    if (
      model &&
      modelFormatForExtension(extname(model.originalName).toLowerCase()) !==
        version.modelFormat
    )
      issues.push({
        code: 'MODEL_FORMAT_MISMATCH',
        message: '模型格式与版本声明不一致',
      });
    for (const asset of assets) {
      const path = this.assetPath(asset);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) {
        issues.push({
          code: 'ASSET_FILE_MISSING',
          message: `资源${asset.id}文件不存在`,
        });
        continue;
      }
      const actual = await this.hashFile(path);
      if (actual !== asset.checksum)
        issues.push({
          code: 'ASSET_CHECKSUM_MISMATCH',
          message: `资源${asset.id}哈希校验失败`,
        });
    }
    const calculatedChecksum = issues.length
      ? null
      : createHash('sha256')
          .update(
            JSON.stringify({
              engineVersion: version.engineVersion,
              modelFormat: version.modelFormat,
              compatibility: this.parseJson(version.compatibility),
              assets: assets.map((asset) => ({
                assetType: asset.assetType,
                actionName: asset.actionName,
                checksum: asset.checksum,
                fileSize: asset.fileSize,
              })),
            }),
          )
          .digest('hex');
    return { valid: !issues.length, issues, calculatedChecksum };
  }

  private async findAccessible(actor: JwtTeacherPayload, id: number) {
    const character = await this.characters.findOne({ where: { id } });
    if (!character) throw new NotFoundException('数字人角色不存在');
    this.assertAccessible(actor, character);
    return character;
  }

  private assertAccessible(
    actor: JwtTeacherPayload,
    character: AvatarCharacter,
  ) {
    if (this.isAdmin(actor)) {
      if (
        actor.schoolId &&
        character.schoolId &&
        actor.schoolId !== character.schoolId
      )
        throw new ForbiddenException('无权访问其他园所数字人角色');
      return;
    }
    if (
      character.ownerType === actor.userType &&
      character.ownerId === actor.sub
    )
      return;
    if (
      character.status === AvatarCharacterStatus.Approved &&
      actor.schoolId &&
      actor.schoolId === character.schoolId
    )
      return;
    throw new ForbiddenException('无权访问该数字人角色');
  }

  private async findManageable(actor: JwtTeacherPayload, id: number) {
    const character = await this.characters.findOne({ where: { id } });
    if (!character) throw new NotFoundException('数字人角色不存在');
    if (this.isAdmin(actor)) {
      if (
        actor.schoolId &&
        character.schoolId &&
        actor.schoolId !== character.schoolId
      )
        throw new ForbiddenException('无权管理其他园所数字人角色');
      return character;
    }
    if (
      character.ownerType !== actor.userType ||
      character.ownerId !== actor.sub
    )
      throw new ForbiddenException('无权修改其他教师的数字人角色');
    return character;
  }

  private async findManageableVersion(
    actor: JwtTeacherPayload,
    versionId: number,
  ) {
    const version = await this.versions.findOne({ where: { id: versionId } });
    if (!version) throw new NotFoundException('数字人版本不存在');
    const character = await this.findManageable(actor, version.characterId);
    return { version, character };
  }

  private characterSummary(character: AvatarCharacter) {
    return {
      id: character.id,
      name: character.name,
      category: character.category,
      description: character.description,
      ownerType: character.ownerType,
      ownerId: character.ownerId,
      schoolId: character.schoolId,
      status: character.status,
      currentVersionId: character.currentVersionId,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    };
  }

  private characterResponse(
    character: AvatarCharacter,
    versions: AvatarVersion[],
    assets: AvatarAsset[] = [],
  ) {
    return {
      ...this.characterSummary(character),
      versions: versions.map((version) =>
        this.versionResponse(
          version,
          assets.filter((asset) => asset.versionId === version.id),
        ),
      ),
    };
  }

  private versionResponse(version: AvatarVersion, assets: AvatarAsset[]) {
    return {
      id: version.id,
      characterId: version.characterId,
      version: version.version,
      engineVersion: version.engineVersion,
      modelFormat: version.modelFormat,
      checksum: version.checksum,
      status: version.status,
      compatibility: this.parseJson(version.compatibility),
      createdAt: version.createdAt,
      assets: assets.map((asset) => this.assetResponse(asset)),
    };
  }

  private assetResponse(asset: AvatarAsset) {
    return {
      id: asset.id,
      versionId: asset.versionId,
      assetType: asset.assetType,
      actionName: asset.actionName,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      checksum: asset.checksum,
      metadata: this.parseJson(asset.metadata),
      contentUrl: `/avatars/assets/${asset.id}/content`,
      createdAt: asset.createdAt,
    };
  }

  private validateActionMapping(dto: UploadAvatarAssetDto) {
    if (dto.assetType === AvatarAssetType.Animation && !dto.actionName)
      throw new BadRequestException('动画资源必须映射白名单动作');
    if (
      dto.assetType !== AvatarAssetType.Animation &&
      dto.actionName !== undefined
    )
      throw new BadRequestException('只有动画资源可以配置动作名称');
  }

  private isSingletonAsset(type: AvatarAssetType) {
    return [
      AvatarAssetType.LipSync,
      AvatarAssetType.Preview,
      AvatarAssetType.Fallback2d,
    ].includes(type);
  }

  private requireAdmin(actor: JwtTeacherPayload) {
    if (!this.isAdmin(actor)) throw new ForbiddenException('仅管理员可执行');
  }

  private isAdmin(actor: JwtTeacherPayload) {
    return (
      actor.userType === AuthUserType.Administrator ||
      actor.role === TeacherRole.Admin
    );
  }

  private assetPath(asset: AvatarAsset) {
    return resolveInside(AVATAR_UPLOAD_DIRECTORY, asset.filePath);
  }

  private async quarantineFiles(
    assets: AvatarAsset[],
  ): Promise<QuarantinedFile[]> {
    const trash = join(AVATAR_UPLOAD_DIRECTORY, '.trash');
    await mkdir(trash, { recursive: true });
    const moved: QuarantinedFile[] = [];
    try {
      for (const asset of assets) {
        const original = this.assetPath(asset);
        const info = await stat(original).catch(() => null);
        if (!info?.isFile())
          throw new InternalServerErrorException(
            '数字人资源文件缺失，删除已停止',
          );
        const quarantined = resolveInside(
          trash,
          `${randomUUID()}-${asset.filePath}`,
        );
        await rename(original, quarantined);
        moved.push({ original, quarantined });
      }
      return moved;
    } catch (error) {
      await this.restoreQuarantined(moved);
      throw error;
    }
  }

  private async restoreQuarantined(files: QuarantinedFile[]) {
    for (const file of files.reverse())
      await rename(file.quarantined, file.original).catch((error) => {
        this.logger.error(`数字人删除回滚失败：${String(error)}`);
      });
  }

  private async hashFile(path: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path))
      hash.update(chunk as Buffer);
    return hash.digest('hex');
  }

  private async safeUnlink(path: string) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT')
        this.logger.error(`数字人残留文件清理失败：${path} ${String(error)}`);
    });
  }

  private parseJson(value: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private parseStringArray(value: string): string[] {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
        ? parsed
        : [];
    } catch {
      return [];
    }
  }

  private isUniqueViolation(error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code.includes('CONSTRAINT') || code === '23505';
  }
}
