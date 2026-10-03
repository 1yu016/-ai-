import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import {
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { extname, join, parse, relative, resolve } from 'node:path';
import { DataSource, IsNull, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { TeacherRole } from '../auth/entities/teacher.entity';
import {
  ResourceReviewStatus,
  type ResourceType,
  TeachingResource,
} from '../data/entities/teaching-resource.entity';
import { OwnerType } from '../data/owner.types';
import { AuditService } from '../platform/audit.service';
import type {
  ConfirmAiSuggestionDto,
  CreateCategoryDto,
  CreateUploadSessionDto,
  ListResourceQueryDto,
  ResourceReferenceDto,
  ResourceReviewDto,
  UpdateResourceDto,
  UploadResourceDto,
} from './dto/resource.dto';
import { ResourceCategory } from './entities/resource-category.entity';
import { ResourceFavorite } from './entities/resource-favorite.entity';
import { ResourceReference } from './entities/resource-reference.entity';
import { ResourceReview } from './entities/resource-review.entity';
import {
  ResourceTag,
  ResourceTagRelation,
} from './entities/resource-tag.entity';
import { ResourceVersion } from './entities/resource-version.entity';
import {
  UploadChunk,
  UploadSession,
  UploadSessionStatus,
} from './entities/upload-session.entity';
import {
  ResourceAiService,
  type ResourceAiSuggestion,
} from './resource-ai.service';
import {
  RESOURCE_CHUNK_DIRECTORY,
  RESOURCE_SIZE_LIMITS,
  RESOURCE_UPLOAD_DIRECTORY,
  resolveInside,
  validateDeclaredFile,
  validateSafeFileName,
  validateUploadedFile,
} from './resource-file.validation';
import type {
  PersonalResource,
  PersonalResourceCategory,
  ResourceCommandResult,
  ResourceMediaType,
} from './resource.types';

type ResourceRecord = PersonalResource & { absolutePath: string };
type SongMetadata = {
  title: string;
  aliases: string[];
  ageGroups: string[];
  domains: string[];
  themes: string[];
};
export type ResourceResponse = {
  id: number;
  title: string;
  aliases: string[];
  description: string | null;
  resourceType: ResourceType;
  category: string;
  categoryId: number | null;
  ageGroup: string;
  domain: string | null;
  tags: string[];
  fileUrl: string;
  coverUrl: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
  sha256: string | null;
  currentVersionId: number | null;
  reviewStatus: string;
  ownerType: OwnerType;
  ownerId: string;
  schoolId: string | null;
  referenceCount: number;
  isFavorite: boolean;
  createdAt: Date;
  updatedAt: Date;
};
export type PaginatedResources = {
  items: ResourceResponse[];
  total: number;
  page: number;
  pageSize: number;
};
export type ResourceSearchResult = ResourceResponse & { score: number };

const SONG_METADATA: Record<string, SongMetadata> = {
  BV1sS421w7fk: {
    title: '小星星',
    aliases: ['一闪一闪亮晶晶', '小星星儿歌'],
    ageGroups: ['小班', '中班'],
    domains: ['艺术', '语言'],
    themes: ['星空', '睡前'],
  },
  BV14K411i7ac: {
    title: '小兔子乖乖',
    aliases: ['小兔子', '兔子乖乖', '小兔乖乖'],
    ageGroups: ['小班', '中班'],
    domains: ['艺术', '语言'],
    themes: ['动物', '安全'],
  },
  BV1Th4y187S8: {
    title: '勇气大爆发',
    aliases: ['心里种下一颗种子', '种子歌'],
    ageGroups: ['中班', '大班'],
    domains: ['艺术', '社会'],
    themes: ['勇气', '成长'],
  },
  BV13G411u753: {
    title: '幸福拍手歌',
    aliases: ['拍手歌', '如果感到幸福你就拍拍手'],
    ageGroups: ['小班', '中班'],
    domains: ['艺术', '健康'],
    themes: ['幸福', '律动'],
  },
  BV1RP4y1X74d: {
    title: '两只老虎',
    aliases: ['两只老虎跑得快'],
    ageGroups: ['小班', '中班'],
    domains: ['艺术', '语言'],
    themes: ['动物', '律动'],
  },
};
const EXTENSION_MEDIA_TYPES: Record<string, ResourceMediaType> = {
  '.mp3': 'audio',
  '.m4a': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.mp4': 'video',
  '.webm': 'video',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.pdf': 'document',
  '.doc': 'document',
  '.docx': 'document',
  '.ppt': 'presentation',
  '.pptx': 'presentation',
};
const MEDIA_CATEGORIES: Record<ResourceMediaType, PersonalResourceCategory> = {
  audio: '歌曲音乐',
  video: '视频动画',
  image: '图片卡片',
  document: '教案课件',
  presentation: '教案课件',
  other: '练习材料',
};
const PLAY_INTENT =
  /(?:打开|播放|放一下|放一首|放放|听一下|听一首|我想听|来一首)/;
const SEARCH_INTENT = /(?:查找|搜索|找一下|有没有|给我看看)/;
const RESOURCE_WORD = /(?:歌|音乐|儿歌|资源|故事|绘本|视频|课件|图片)/;
const normalizeText = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s]/gu, '');
const normalizedStringList = (values?: string[]) => [
  ...new Set((values ?? []).map((v) => v.trim()).filter(Boolean)),
];
function parseStoredList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);
  private readonly libraryDirectory: string;
  private readonly sharedOwnerId: string;

  constructor(
    config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(TeachingResource)
    private readonly resources: Repository<TeachingResource>,
    @InjectRepository(ResourceVersion)
    private readonly versions: Repository<ResourceVersion>,
    @InjectRepository(ResourceCategory)
    private readonly categories: Repository<ResourceCategory>,
    @InjectRepository(ResourceTag)
    private readonly tags: Repository<ResourceTag>,
    @InjectRepository(ResourceTagRelation)
    private readonly tagRelations: Repository<ResourceTagRelation>,
    @InjectRepository(ResourceFavorite)
    private readonly favorites: Repository<ResourceFavorite>,
    @InjectRepository(ResourceReference)
    private readonly references: Repository<ResourceReference>,
    @InjectRepository(ResourceReview)
    private readonly reviews: Repository<ResourceReview>,
    @InjectRepository(UploadSession)
    private readonly uploadSessions: Repository<UploadSession>,
    @InjectRepository(UploadChunk)
    private readonly uploadChunks: Repository<UploadChunk>,
    private readonly audit: AuditService,
    private readonly resourceAi: ResourceAiService,
  ) {
    const configured = config.get<string>('RESOURCE_LIBRARY_PATH')?.trim();
    const candidates = [
      configured,
      join(process.cwd(), 'test-resources'),
      join(process.cwd(), '..', 'test-resources'),
    ].filter((v): v is string => Boolean(v));
    this.libraryDirectory =
      candidates.find((v) => existsSync(resolve(v))) ??
      resolve(candidates[0] ?? join(process.cwd(), 'test-resources'));
    this.sharedOwnerId =
      config.get<string>('GARDEN_SHARED_OWNER_ID')?.trim() || 'garden:shared';
  }

  getLibraryDirectory(): string {
    return this.libraryDirectory;
  }
  async list(): Promise<PersonalResource[]>;
  async list(
    teacherId: number,
    query: ListResourceQueryDto,
  ): Promise<PaginatedResources>;
  async list(
    actor: JwtTeacherPayload,
    query: ListResourceQueryDto,
  ): Promise<PaginatedResources>;
  async list(
    actorInput?: JwtTeacherPayload | number,
    query?: ListResourceQueryDto,
  ): Promise<PaginatedResources | PersonalResource[]> {
    if (actorInput === undefined || !query)
      return (await this.scanLegacyLibrary()).map((item) =>
        this.withoutAbsolutePath(item),
      );
    const actor = this.asActor(actorInput);
    const builder = this.resources
      .createQueryBuilder('r')
      .where('r.deleted_at IS NULL');
    if (!this.isAdmin(actor)) {
      builder.andWhere(
        '((r.owner_type = :teacher AND r.owner_id = :owner) OR (r.review_status = :approved AND (r.school_id = :school OR r.owner_id = :shared)))',
        {
          teacher: OwnerType.Teacher,
          owner: String(actor.sub),
          approved: ResourceReviewStatus.Approved,
          school: actor.schoolId ?? '',
          shared: this.sharedOwnerId,
        },
      );
    } else if (actor.schoolId)
      builder.andWhere('(r.school_id = :school OR r.owner_id = :shared)', {
        school: actor.schoolId,
        shared: this.sharedOwnerId,
      });
    if (query.category)
      builder.andWhere('r.category = :category', { category: query.category });
    if (query.categoryId)
      builder.andWhere('r.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    if (query.resourceType)
      builder.andWhere('r.resource_type = :resourceType', {
        resourceType: query.resourceType,
      });
    if (query.ageGroup)
      builder.andWhere('r.age_group = :ageGroup', { ageGroup: query.ageGroup });
    if (query.domain)
      builder.andWhere('r.domain = :domain', { domain: query.domain });
    if (query.reviewStatus)
      builder.andWhere('r.review_status = :reviewStatus', {
        reviewStatus: query.reviewStatus,
      });
    if (query.tag)
      builder.andWhere('r.tags LIKE :tag', {
        tag: `%${this.escapeLike(query.tag)}%`,
      });
    if (query.keyword?.trim())
      builder.andWhere(
        "(r.title LIKE :keyword ESCAPE '\\' OR r.aliases LIKE :keyword ESCAPE '\\' OR r.tags LIKE :keyword ESCAPE '\\')",
        { keyword: `%${this.escapeLike(query.keyword.trim())}%` },
      );
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 20;
    const [items, total] = await builder
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      items: await Promise.all(items.map((r) => this.toResponse(r, actor.sub))),
      total,
      page,
      pageSize,
    };
  }

  async search(
    actorInput: JwtTeacherPayload | number,
    keyword: string,
    resourceType?: ResourceType,
  ): Promise<ResourceSearchResult[]> {
    const actor = this.asActor(actorInput);
    const normalized = normalizeText(keyword.trim());
    if (!normalized) throw new BadRequestException('搜索关键词不能为空');
    const page = await this.list(actor, {
      keyword,
      resourceType,
      page: 1,
      pageSize: 100,
    });
    return page.items
      .map((r) => ({ ...r, score: this.searchScore(r, normalized) }))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id - a.id,
      );
  }

  async getOne(
    actorInput: JwtTeacherPayload | number,
    id: number,
  ): Promise<ResourceResponse> {
    const actor = this.asActor(actorInput);
    return this.toResponse(await this.findAccessible(actor, id), actor.sub);
  }

  async upload(
    actor: JwtTeacherPayload,
    dto: UploadResourceDto,
    file?: Express.Multer.File,
  ): Promise<ResourceResponse> {
    try {
      const rule = await validateUploadedFile(file, dto.resourceType);
      const uploaded = file!;
      const sha256 = await this.hashFile(uploaded.path);
      const saved = await this.dataSource.transaction(async (manager) => {
        const resourceRepo = manager.getRepository(TeachingResource),
          versionRepo = manager.getRepository(ResourceVersion);
        let resource = await resourceRepo.save(
          resourceRepo.create({
            title: dto.title.trim(),
            aliases: JSON.stringify(normalizedStringList(dto.aliases)),
            description: dto.description?.trim() || null,
            schoolId: actor.schoolId ?? null,
            resourceType: rule.resourceType,
            category: dto.category.trim(),
            categoryId: dto.categoryId ?? null,
            ageGroup: dto.ageGroup,
            domain: dto.domain?.trim() || null,
            tags: JSON.stringify(normalizedStringList(dto.tags)),
            fileUrl: '',
            coverUrl: null,
            fileName: uploaded.originalname,
            mimeType: rule.mimeType,
            fileSize: uploaded.size,
            duration: dto.duration ?? null,
            currentVersionId: null,
            aiTeachingGoals: null,
            aiActivitySuggestions: null,
            reviewStatus: ResourceReviewStatus.Draft,
            deletedAt: null,
            ownerType:
              actor.userType === AuthUserType.Administrator
                ? OwnerType.Administrator
                : OwnerType.Teacher,
            ownerId: String(actor.sub),
            type: null,
            url: null,
          }),
        );
        const version = await versionRepo.save(
          versionRepo.create({
            resourceId: resource.id,
            versionNo: 1,
            originalName: uploaded.originalname,
            storageName: uploaded.filename,
            storagePath: uploaded.filename,
            sha256,
            mimeType: rule.mimeType,
            fileSize: uploaded.size,
            duration: dto.duration ?? null,
            createdBy: actor.sub,
            createdByType: actor.userType,
          }),
        );
        resource.currentVersionId = version.id;
        resource.fileUrl = `/resources/${resource.id}/download`;
        resource = await resourceRepo.save(resource);
        return resource;
      });
      try {
        await this.syncTags(saved.id, dto.tags ?? []);
      } catch (error) {
        await this.versions.delete({ resourceId: saved.id });
        await this.resources.delete(saved.id);
        throw error;
      }
      await this.audit.write(actor, {
        action: 'resource.upload',
        targetType: 'resource',
        targetId: saved.id,
        metadata: {
          resourceType: saved.resourceType,
          fileSize: saved.fileSize,
          sha256,
        },
      });
      return this.toResponse(saved, actor.sub);
    } catch (error) {
      if (file?.path) await this.safeUnlink(file.path);
      if (error instanceof HttpException) throw error;
      this.logger.error(
        'resource.upload.failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('资源上传失败，请稍后重试');
    }
  }

  async addVersion(
    actor: JwtTeacherPayload,
    id: number,
    file?: Express.Multer.File,
    requestedType?: ResourceType,
  ): Promise<ResourceResponse> {
    const resource = await this.findManageable(actor, id);
    try {
      const rule = await validateUploadedFile(
        file,
        requestedType ?? resource.resourceType,
      );
      const uploaded = file!;
      const sha256 = await this.hashFile(uploaded.path);
      const { version, saved } = await this.dataSource.transaction(
        async (manager) => {
          const versionRepo = manager.getRepository(ResourceVersion);
          const resourceRepo = manager.getRepository(TeachingResource);
          const count = await versionRepo.count({ where: { resourceId: id } });
          const version = await versionRepo.save(
            versionRepo.create({
              resourceId: id,
              versionNo: count + 1,
              originalName: uploaded.originalname,
              storageName: uploaded.filename,
              storagePath: uploaded.filename,
              sha256,
              mimeType: rule.mimeType,
              fileSize: uploaded.size,
              duration: null,
              createdBy: actor.sub,
              createdByType: actor.userType,
            }),
          );
          resource.currentVersionId = version.id;
          resource.fileName = uploaded.originalname;
          resource.mimeType = rule.mimeType;
          resource.fileSize = uploaded.size;
          resource.resourceType = rule.resourceType;
          resource.reviewStatus = ResourceReviewStatus.Draft;
          const saved = await resourceRepo.save(resource);
          return { version, saved };
        },
      );
      await this.audit.write(actor, {
        action: 'resource.version.create',
        targetType: 'resource',
        targetId: id,
        metadata: { versionNo: version.versionNo, sha256 },
      });
      return this.toResponse(saved, actor.sub);
    } catch (error) {
      if (file?.path) await this.safeUnlink(file.path);
      throw error;
    }
  }

  async update(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateResourceDto,
  ): Promise<ResourceResponse> {
    const r = await this.findManageable(actor, id);
    if (dto.title !== undefined) r.title = dto.title.trim();
    if (dto.aliases !== undefined)
      r.aliases = JSON.stringify(normalizedStringList(dto.aliases));
    if (dto.description !== undefined)
      r.description = dto.description.trim() || null;
    if (dto.category !== undefined) r.category = dto.category.trim();
    if (dto.categoryId !== undefined) r.categoryId = dto.categoryId;
    if (dto.ageGroup !== undefined) r.ageGroup = dto.ageGroup;
    if (dto.domain !== undefined) r.domain = dto.domain.trim() || null;
    if (dto.tags !== undefined) {
      r.tags = JSON.stringify(normalizedStringList(dto.tags));
      await this.syncTags(id, dto.tags);
    }
    const saved = await this.resources.save(r);
    await this.audit.write(actor, {
      action: 'resource.update',
      targetType: 'resource',
      targetId: id,
    });
    return this.toResponse(saved, actor.sub);
  }

  async remove(
    actor: JwtTeacherPayload,
    id: number,
  ): Promise<{ referenceCount: number }> {
    const resource = await this.findManageable(actor, id);
    const referenceCount = await this.references.count({
      where: { resourceId: id },
    });
    if (referenceCount)
      throw new ConflictException({
        message: '资源正在被引用，无法删除',
        referenceCount,
      });
    const versions = await this.versions.find({ where: { resourceId: id } });
    for (const version of versions)
      await this.safeUnlink(
        resolveInside(RESOURCE_UPLOAD_DIRECTORY, version.storagePath),
        true,
      );
    if (!versions.length && resource.fileUrl.startsWith('/uploads/resources/'))
      await this.safeUnlink(
        resolveInside(
          RESOURCE_UPLOAD_DIRECTORY,
          resource.fileUrl.slice('/uploads/resources/'.length),
        ),
        true,
      );
    resource.deletedAt = new Date();
    resource.reviewStatus = ResourceReviewStatus.Disabled;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ResourceFavorite).delete({ resourceId: id });
      await manager
        .getRepository(ResourceTagRelation)
        .delete({ resourceId: id });
      await manager.getRepository(TeachingResource).save(resource);
    });
    await this.audit.write(actor, {
      action: 'resource.delete',
      targetType: 'resource',
      targetId: id,
    });
    return { referenceCount: 0 };
  }

  async favorite(actor: JwtTeacherPayload, id: number): Promise<void> {
    await this.findAccessible(actor, id);
    const found = await this.favorites.findOne({
      where: { teacherId: actor.sub, resourceId: id },
    });
    if (!found)
      await this.favorites.save(
        this.favorites.create({ teacherId: actor.sub, resourceId: id }),
      );
  }
  async unfavorite(actor: JwtTeacherPayload, id: number): Promise<void> {
    await this.favorites.delete({ teacherId: actor.sub, resourceId: id });
  }
  async addReference(
    actor: JwtTeacherPayload,
    id: number,
    dto: ResourceReferenceDto,
  ) {
    await this.findAccessible(actor, id);
    const existing = await this.references.findOne({
      where: {
        resourceId: id,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
      },
    });
    return (
      existing ??
      this.references.save(
        this.references.create({
          resourceId: id,
          ...dto,
          createdBy: actor.sub,
        }),
      )
    );
  }
  async removeReference(
    actor: JwtTeacherPayload,
    id: number,
    dto: ResourceReferenceDto,
  ): Promise<void> {
    const resource = await this.findAccessible(actor, id);
    if (resource.ownerId !== String(actor.sub) && !this.isAdmin(actor))
      throw new ForbiddenException('无权取消该引用');
    await this.references.delete({
      resourceId: id,
      referenceType: dto.referenceType,
      referenceId: dto.referenceId,
    });
  }

  async submitReview(
    actor: JwtTeacherPayload,
    id: number,
  ): Promise<ResourceResponse> {
    const r = await this.findManageable(actor, id);
    if (r.reviewStatus === ResourceReviewStatus.Disabled)
      throw new ConflictException('已停用资源不能提交审核');
    r.reviewStatus = ResourceReviewStatus.Pending;
    const saved = await this.resources.save(r);
    await this.audit.write(actor, {
      action: 'resource.review.submit',
      targetType: 'resource',
      targetId: id,
    });
    return this.toResponse(saved, actor.sub);
  }
  async review(
    actor: JwtTeacherPayload,
    id: number,
    dto: ResourceReviewDto,
  ): Promise<ResourceResponse> {
    if (!this.isAdmin(actor))
      throw new ForbiddenException('仅管理员可审核资源');
    if (
      ![
        ResourceReviewStatus.Approved,
        ResourceReviewStatus.Rejected,
        ResourceReviewStatus.Disabled,
      ].includes(dto.status)
    )
      throw new BadRequestException('审核结果不合法');
    const r = await this.findManageable(actor, id);
    if (
      dto.status !== ResourceReviewStatus.Disabled &&
      r.reviewStatus !== ResourceReviewStatus.Pending
    )
      throw new ConflictException('资源尚未由教师提交审核');
    r.reviewStatus = dto.status;
    const saved = await this.resources.save(r);
    await this.reviews.save(
      this.reviews.create({
        resourceId: id,
        reviewerId: actor.sub,
        status: dto.status,
        comment: dto.comment?.trim() || null,
        reviewedAt: new Date(),
      }),
    );
    await this.audit.write(actor, {
      action: 'resource.review',
      targetType: 'resource',
      targetId: id,
      metadata: { status: dto.status },
    });
    return this.toResponse(saved, actor.sub);
  }

  async download(
    actor: JwtTeacherPayload,
    id: number,
  ): Promise<{
    path: string;
    size: number;
    mimeType: string;
    fileName: string;
  }> {
    const resource = await this.findAccessible(actor, id);
    if (!resource.currentVersionId) {
      const legacyPrefix = '/uploads/resources/';
      if (!resource.fileUrl.startsWith(legacyPrefix))
        throw new NotFoundException('资源版本不存在');
      const path = resolveInside(
        RESOURCE_UPLOAD_DIRECTORY,
        resource.fileUrl.slice(legacyPrefix.length),
      );
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) throw new NotFoundException('资源文件不存在');
      return {
        path,
        size: info.size,
        mimeType: resource.mimeType,
        fileName: resource.fileName,
      };
    }
    const version = await this.versions.findOne({
      where: { id: resource.currentVersionId, resourceId: id },
    });
    if (!version) throw new NotFoundException('资源版本不存在');
    const path = resolveInside(RESOURCE_UPLOAD_DIRECTORY, version.storagePath);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('资源文件不存在');
    return {
      path,
      size: info.size,
      mimeType: version.mimeType,
      fileName: version.originalName,
    };
  }

  async createCategory(actor: JwtTeacherPayload, dto: CreateCategoryDto) {
    if (!this.isAdmin(actor))
      throw new ForbiddenException('仅管理员可管理分类');
    if (
      dto.parentId &&
      !(await this.categories.findOne({ where: { id: dto.parentId } }))
    )
      throw new NotFoundException('上级分类不存在');
    return this.categories.save(
      this.categories.create({
        name: dto.name.trim(),
        parentId: dto.parentId ?? null,
        sort: dto.sort ?? 0,
        enabled: true,
      }),
    );
  }
  listCategories() {
    return this.categories.find({
      where: { enabled: true },
      order: { sort: 'ASC', id: 'ASC' },
    });
  }

  async createUploadSession(
    actor: JwtTeacherPayload,
    dto: CreateUploadSessionDto,
  ) {
    const resourceType = dto.resourceType;
    if (!resourceType)
      throw new BadRequestException('分片上传必须指定 resourceType');
    const rule = validateDeclaredFile(
      { originalname: dto.originalName, mimetype: dto.declaredMime },
      resourceType,
    );
    if (dto.totalSize > RESOURCE_SIZE_LIMITS[resourceType])
      throw new BadRequestException('文件大小超限');
    const totalChunks = Math.ceil(dto.totalSize / dto.chunkSize);
    const session = await this.uploadSessions.save(
      this.uploadSessions.create({
        userId: actor.sub,
        userType: actor.userType,
        schoolId: actor.schoolId ?? null,
        title: dto.title.trim(),
        originalName: dto.originalName,
        declaredMime: dto.declaredMime,
        resourceType: rule.resourceType,
        category: dto.category.trim(),
        ageGroup: dto.ageGroup,
        totalSize: dto.totalSize,
        chunkSize: dto.chunkSize,
        totalChunks,
        expectedSha256: dto.expectedSha256?.toLowerCase() ?? null,
        status: UploadSessionStatus.Active,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      }),
    );
    await mkdir(join(RESOURCE_CHUNK_DIRECTORY, session.id), {
      recursive: true,
    });
    return { ...session, uploadedChunks: [] };
  }
  async listUploadedChunks(actor: JwtTeacherPayload, id: string) {
    const session = await this.requireUploadSession(actor, id);
    const chunks = await this.uploadChunks.find({
      where: { sessionId: id },
      order: { chunkNo: 'ASC' },
    });
    return {
      sessionId: id,
      status: session.status,
      totalChunks: session.totalChunks,
      uploadedChunks: chunks.map((c) => ({
        chunkNo: c.chunkNo,
        fileSize: c.fileSize,
        sha256: c.sha256,
      })),
    };
  }
  async uploadChunk(
    actor: JwtTeacherPayload,
    id: string,
    chunkNo: number,
    expectedHash: string,
    file?: Express.Multer.File,
  ) {
    const session = await this.requireActiveSession(actor, id);
    if (!file) throw new BadRequestException('缺少分片文件');
    try {
      if (chunkNo < 0 || chunkNo >= session.totalChunks)
        throw new BadRequestException('分片编号超出范围');
      const expectedSize =
        chunkNo === session.totalChunks - 1
          ? session.totalSize - session.chunkSize * (session.totalChunks - 1)
          : session.chunkSize;
      if (file.size !== expectedSize)
        throw new BadRequestException('分片大小不正确');
      const actual = await this.hashFile(file.path);
      if (actual !== expectedHash.toLowerCase())
        throw new BadRequestException('分片 SHA256 不匹配');
      const existing = await this.uploadChunks.findOne({
        where: { sessionId: id, chunkNo },
      });
      if (existing) {
        if (existing.sha256 === actual && existing.fileSize === file.size) {
          await this.safeUnlink(file.path);
          return existing;
        }
        throw new ConflictException('该分片已存在且内容不同');
      }
      const folder = join(RESOURCE_CHUNK_DIRECTORY, id);
      await mkdir(folder, { recursive: true });
      const finalPath = resolveInside(folder, `${chunkNo}.part`);
      await rename(file.path, finalPath);
      return this.uploadChunks.save(
        this.uploadChunks.create({
          sessionId: id,
          chunkNo,
          fileSize: file.size,
          sha256: actual,
          storagePath: relative(RESOURCE_CHUNK_DIRECTORY, finalPath),
        }),
      );
    } catch (error) {
      if (file?.path) await this.safeUnlink(file.path);
      throw error;
    }
  }
  async completeUpload(
    actor: JwtTeacherPayload,
    id: string,
  ): Promise<ResourceResponse> {
    const session = await this.requireActiveSession(actor, id);
    const chunks = await this.uploadChunks.find({
      where: { sessionId: id },
      order: { chunkNo: 'ASC' },
    });
    if (
      chunks.length !== session.totalChunks ||
      chunks.some((c, i) => c.chunkNo !== i)
    )
      throw new ConflictException('分片不完整，无法合并');
    const locked = await this.uploadSessions
      .createQueryBuilder()
      .update()
      .set({ status: UploadSessionStatus.Merging })
      .where('id = :id AND status = :status', {
        id,
        status: UploadSessionStatus.Active,
      })
      .execute();
    if (locked.affected !== 1)
      throw new ConflictException('上传会话正在合并或已完成');
    const extension = validateSafeFileName(session.originalName);
    const storageName = `${id}${extension}`;
    const finalPath = resolveInside(RESOURCE_UPLOAD_DIRECTORY, storageName);
    try {
      const output = await open(finalPath, 'w');
      try {
        for (const chunk of chunks) {
          const input = await open(
            resolveInside(RESOURCE_CHUNK_DIRECTORY, chunk.storagePath),
            'r',
          );
          try {
            for await (const data of input.createReadStream())
              await output.write(data as Buffer);
          } finally {
            await input.close();
          }
        }
      } finally {
        await output.close();
      }
      const info = await stat(finalPath);
      if (info.size !== session.totalSize)
        throw new Error('合并后文件大小不匹配');
      const sha256 = await this.hashFile(finalPath);
      if (session.expectedSha256 && sha256 !== session.expectedSha256)
        throw new BadRequestException('合并文件 SHA256 不匹配');
      const validation = await validateUploadedFile(
        {
          path: finalPath,
          size: info.size,
          originalname: session.originalName,
          mimetype: session.declaredMime,
        } as Express.Multer.File,
        session.resourceType,
      );
      const resource = await this.persistMerged(
        actor,
        session,
        storageName,
        sha256,
        validation.mimeType,
      );
      session.status = UploadSessionStatus.Completed;
      await this.uploadSessions.save(session);
      await this.cleanupSessionFiles(id, chunks);
      return this.toResponse(resource, actor.sub);
    } catch (error) {
      await this.safeUnlink(finalPath);
      session.status = UploadSessionStatus.Failed;
      await this.uploadSessions.save(session);
      await this.cleanupSessionFiles(id, chunks);
      throw error;
    }
  }
  async abortUpload(actor: JwtTeacherPayload, id: string): Promise<void> {
    const session = await this.requireUploadSession(actor, id);
    if (session.status === UploadSessionStatus.Completed)
      throw new ConflictException('已完成会话不能中止');
    const chunks = await this.uploadChunks.find({ where: { sessionId: id } });
    await this.cleanupSessionFiles(id, chunks);
    session.status = UploadSessionStatus.Aborted;
    await this.uploadSessions.save(session);
  }
  async cleanupExpiredUploads(): Promise<number> {
    const expired = await this.uploadSessions
      .createQueryBuilder('s')
      .where('s.expires_at <= :now', { now: new Date() })
      .andWhere('s.status = :status', { status: UploadSessionStatus.Active })
      .getMany();
    for (const s of expired) {
      const chunks = await this.uploadChunks.find({
        where: { sessionId: s.id },
      });
      await this.cleanupSessionFiles(s.id, chunks);
      s.status = UploadSessionStatus.Expired;
      await this.uploadSessions.save(s);
    }
    return expired.length;
  }

  @Interval(60 * 60 * 1000)
  async scheduledUploadCleanup(): Promise<void> {
    try {
      await this.cleanupExpiredUploads();
    } catch (error) {
      this.logger.error(
        'resource.upload.cleanup.failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async aiSuggestion(
    actor: JwtTeacherPayload,
    id: number,
  ): Promise<ResourceAiSuggestion> {
    const r = await this.findManageable(actor, id);
    return this.resourceAi.suggest(actor, {
      title: r.title,
      description: r.description,
      resourceType: r.resourceType,
      existingTags: parseStoredList(r.tags),
    });
  }
  async confirmAiSuggestion(
    actor: JwtTeacherPayload,
    id: number,
    dto: ConfirmAiSuggestionDto,
  ): Promise<ResourceResponse> {
    const r = await this.findManageable(actor, id);
    r.tags = JSON.stringify(normalizedStringList(dto.tags));
    r.ageGroup = dto.ageGroup;
    r.aiTeachingGoals = dto.teachingGoals.trim();
    r.aiActivitySuggestions = dto.activitySuggestions.trim();
    await this.syncTags(id, dto.tags);
    const saved = await this.resources.save(r);
    await this.audit.write(actor, {
      action: 'resource.ai_suggestion.confirm',
      targetType: 'resource',
      targetId: id,
    });
    return this.toResponse(saved, actor.sub);
  }

  async getFile(id: string): Promise<{ path: string; size: number }> {
    const resource = (await this.scanLegacyLibrary()).find((r) => r.id === id);
    if (!resource) throw new NotFoundException('资源不存在或已被移动');
    const info = await stat(resource.absolutePath);
    return { path: resource.absolutePath, size: info.size };
  }
  async handleCommand(text: string): Promise<ResourceCommandResult | null> {
    const wantsPlay = PLAY_INTENT.test(text),
      wantsSearch = SEARCH_INTENT.test(text);
    if (!wantsPlay && !wantsSearch) return null;
    const resources = (await this.scanLegacyLibrary()).map((item) =>
      this.withoutAbsolutePath(item),
    );
    const input = normalizeText(text);
    const scored = resources
      .map((resource) => ({
        resource,
        score: Math.max(
          0,
          ...[resource.title, ...resource.aliases]
            .map(normalizeText)
            .filter((v) => v && input.includes(v))
            .map((v) => v.length),
        ),
      }))
      .filter((i) => i.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length)
      return RESOURCE_WORD.test(text)
        ? {
            reply:
              '我在个人资源中没有找到这个内容。你可以试试说完整的资源名称。',
          }
        : null;
    const best = scored.filter((i) => i.score === scored[0].score);
    if (best.length > 1)
      return {
        reply: `找到了几个相似资源：${best
          .slice(0, 3)
          .map((i) => `《${i.resource.title}》`)
          .join('、')}。请告诉我你想要哪一个。`,
      };
    const resource = best[0].resource;
    return wantsPlay && resource.mediaType === 'audio'
      ? {
          reply: `已为你播放《${resource.title}》。`,
          action: { type: 'play', resource },
        }
      : {
          reply: `已找到《${resource.title}》，位于个人资源的“${resource.category}”分类中。`,
        };
  }

  private isAdmin(actor: JwtTeacherPayload) {
    return (
      actor.userType === AuthUserType.Administrator ||
      actor.role === TeacherRole.Admin
    );
  }

  private asActor(actor: JwtTeacherPayload | number): JwtTeacherPayload {
    if (typeof actor !== 'number') return actor;
    return {
      sub: actor,
      account: '',
      name: '',
      role: TeacherRole.Teacher,
      userType: AuthUserType.Teacher,
      tokenVersion: 0,
      schoolId: null,
    };
  }
  private async findAccessible(actor: JwtTeacherPayload, id: number) {
    const r = await this.resources.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!r) throw new NotFoundException('资源不存在');
    if (this.isAdmin(actor)) {
      if (actor.schoolId && r.schoolId && actor.schoolId !== r.schoolId)
        throw new ForbiddenException('无权访问其他园所资源');
      return r;
    }
    if (r.ownerType === OwnerType.Teacher && r.ownerId === String(actor.sub))
      return r;
    if (
      r.reviewStatus === ResourceReviewStatus.Approved &&
      (r.ownerId === this.sharedOwnerId ||
        Boolean(actor.schoolId && r.schoolId === actor.schoolId))
    )
      return r;
    throw new NotFoundException('资源不存在或无权访问');
  }
  private async findManageable(actor: JwtTeacherPayload, id: number) {
    const r = await this.resources.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!r) throw new NotFoundException('资源不存在');
    if (
      !this.isAdmin(actor) &&
      !(r.ownerType === OwnerType.Teacher && r.ownerId === String(actor.sub))
    )
      throw new NotFoundException('资源不存在或无权管理');
    if (
      this.isAdmin(actor) &&
      actor.schoolId &&
      r.schoolId &&
      actor.schoolId !== r.schoolId
    )
      throw new ForbiddenException('无权管理其他园所资源');
    return r;
  }
  private async toResponse(
    r: TeachingResource,
    teacherId: number,
  ): Promise<ResourceResponse> {
    const version = r.currentVersionId
      ? await this.versions.findOne({ where: { id: r.currentVersionId } })
      : null;
    const [referenceCount, favorite] = await Promise.all([
      this.references.count({ where: { resourceId: r.id } }),
      this.favorites.findOne({ where: { teacherId, resourceId: r.id } }),
    ]);
    return {
      id: r.id,
      title: r.title,
      aliases: parseStoredList(r.aliases),
      description: r.description,
      resourceType: r.resourceType,
      category: r.category,
      categoryId: r.categoryId,
      ageGroup: r.ageGroup,
      domain: r.domain,
      tags: parseStoredList(r.tags),
      fileUrl: `/resources/${r.id}/download`,
      coverUrl: r.coverUrl,
      fileName: r.fileName,
      mimeType: r.mimeType,
      fileSize: r.fileSize,
      duration: r.duration,
      sha256: version?.sha256 ?? null,
      currentVersionId: r.currentVersionId,
      reviewStatus: r.reviewStatus,
      ownerType: r.ownerType,
      ownerId: r.ownerId,
      schoolId: r.schoolId,
      referenceCount,
      isFavorite: Boolean(favorite),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
  private async syncTags(resourceId: number, names: string[]) {
    await this.dataSource.transaction(async (manager) => {
      const relRepo = manager.getRepository(ResourceTagRelation),
        tagRepo = manager.getRepository(ResourceTag);
      await relRepo.delete({ resourceId });
      for (const name of normalizedStringList(names)) {
        let tag = await tagRepo.findOne({ where: { name } });
        if (!tag) tag = await tagRepo.save(tagRepo.create({ name }));
        await relRepo.save(relRepo.create({ resourceId, tagId: tag.id }));
      }
    });
  }
  private async persistMerged(
    actor: JwtTeacherPayload,
    s: UploadSession,
    storageName: string,
    sha256: string,
    mimeType: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const rr = manager.getRepository(TeachingResource),
        vr = manager.getRepository(ResourceVersion);
      let r = await rr.save(
        rr.create({
          title: s.title,
          aliases: '[]',
          description: null,
          schoolId: s.schoolId,
          resourceType: s.resourceType,
          category: s.category,
          categoryId: null,
          ageGroup: s.ageGroup,
          domain: null,
          tags: '[]',
          fileUrl: '',
          coverUrl: null,
          fileName: s.originalName,
          mimeType,
          fileSize: s.totalSize,
          duration: null,
          currentVersionId: null,
          aiTeachingGoals: null,
          aiActivitySuggestions: null,
          reviewStatus: ResourceReviewStatus.Draft,
          deletedAt: null,
          ownerType:
            actor.userType === AuthUserType.Administrator
              ? OwnerType.Administrator
              : OwnerType.Teacher,
          ownerId: String(actor.sub),
          type: null,
          url: null,
        }),
      );
      const v = await vr.save(
        vr.create({
          resourceId: r.id,
          versionNo: 1,
          originalName: s.originalName,
          storageName,
          storagePath: storageName,
          sha256,
          mimeType,
          fileSize: s.totalSize,
          duration: null,
          createdBy: actor.sub,
          createdByType: actor.userType,
        }),
      );
      r.currentVersionId = v.id;
      r.fileUrl = `/resources/${r.id}/download`;
      return rr.save(r);
    });
  }
  private async requireUploadSession(actor: JwtTeacherPayload, id: string) {
    const s = await this.uploadSessions.findOne({ where: { id } });
    if (!s) throw new NotFoundException('上传会话不存在');
    if (
      (s.userId !== actor.sub || s.userType !== actor.userType) &&
      !this.isAdmin(actor)
    )
      throw new ForbiddenException('无权访问其他教师的上传会话');
    return s;
  }
  private async requireActiveSession(actor: JwtTeacherPayload, id: string) {
    const s = await this.requireUploadSession(actor, id);
    if (s.expiresAt.getTime() <= Date.now()) {
      const chunks = await this.uploadChunks.find({ where: { sessionId: id } });
      await this.cleanupSessionFiles(id, chunks);
      s.status = UploadSessionStatus.Expired;
      await this.uploadSessions.save(s);
      throw new BadRequestException('上传会话已过期');
    }
    if (s.status !== UploadSessionStatus.Active)
      throw new ConflictException('上传会话不可用');
    return s;
  }
  private async cleanupSessionFiles(id: string, chunks: UploadChunk[]) {
    for (const c of chunks)
      await this.safeUnlink(
        resolveInside(RESOURCE_CHUNK_DIRECTORY, c.storagePath),
      );
    await this.uploadChunks.delete({ sessionId: id });
    await rm(join(RESOURCE_CHUNK_DIRECTORY, id), {
      recursive: true,
      force: true,
    });
  }
  private async hashFile(path: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path))
      hash.update(chunk as Buffer);
    return hash.digest('hex');
  }
  private async safeUnlink(path: string, fail = false) {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (fail) throw new InternalServerErrorException('资源文件删除失败');
    }
  }
  private searchScore(r: ResourceResponse, k: string) {
    const title = normalizeText(r.title),
      aliases = r.aliases.map(normalizeText),
      tags = r.tags.map(normalizeText);
    if (title === k) return 1000;
    if (aliases.includes(k)) return 900;
    if (tags.includes(k)) return 800;
    if (title.includes(k)) return 700;
    if (aliases.some((v) => v.includes(k))) return 600;
    if (tags.some((v) => v.includes(k))) return 500;
    return 0;
  }
  private escapeLike(v: string) {
    return v.replace(/[\\%_]/g, (m) => `\\${m}`);
  }
  private async scanLegacyLibrary(): Promise<ResourceRecord[]> {
    if (!existsSync(this.libraryDirectory)) return [];
    const entries = await readdir(this.libraryDirectory, {
      withFileTypes: true,
    });
    return entries
      .filter((e) => e.isFile())
      .map((e) => this.toLegacyResource(e.name))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }
  private toLegacyResource(fileName: string): ResourceRecord {
    const mediaType =
      EXTENSION_MEDIA_TYPES[extname(fileName).toLowerCase()] ?? 'other';
    const bvid = fileName.match(/\[(BV[a-zA-Z0-9]+)]/)?.[1];
    const metadata = bvid ? SONG_METADATA[bvid] : undefined;
    const title =
      metadata?.title ||
      parse(fileName)
        .name.replace(/\s*\[[^\]]+]\s*$/, '')
        .replace(/^(?:《|「)/, '')
        .replace(/(?:》|」).*$/, '')
        .trim() ||
      fileName;
    const id =
      bvid ?? createHash('sha1').update(fileName).digest('hex').slice(0, 16);
    return {
      id,
      title,
      fileName,
      category: MEDIA_CATEGORIES[mediaType],
      subcategory: mediaType === 'audio' ? '儿歌' : undefined,
      aliases: metadata?.aliases ?? [],
      ageGroups: metadata?.ageGroups ?? [],
      domains: metadata?.domains ?? [],
      themes: metadata?.themes ?? [],
      mediaType,
      contentUrl: `/resources/${encodeURIComponent(id)}/content`,
      absolutePath: join(this.libraryDirectory, fileName),
    };
  }

  private withoutAbsolutePath(resource: ResourceRecord): PersonalResource {
    const result: Partial<ResourceRecord> = { ...resource };
    delete result.absolutePath;
    return result as PersonalResource;
  }
}
