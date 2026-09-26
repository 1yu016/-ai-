import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { extname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { TeacherRole } from '../auth/entities/teacher.entity';
import {
  ResourceReviewStatus,
  type ResourceType,
  TeachingResource,
} from '../data/entities/teaching-resource.entity';
import { OwnerType } from '../data/owner.types';
import type {
  ListResourceQueryDto,
  UpdateResourceDto,
  UploadResourceDto,
} from './dto/resource.dto';
import {
  RESOURCE_UPLOAD_DIRECTORY,
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
  ageGroup: string;
  tags: string[];
  fileUrl: string;
  coverUrl: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
  reviewStatus: string;
  ownerType: OwnerType;
  ownerId: string;
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

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}
function cleanFileTitle(fileName: string): string {
  return parse(fileName)
    .name.replace(/\s*\[[^\]]+]\s*$/, '')
    .replace(/^(?:《|「)/, '')
    .replace(/(?:》|」).*$/, '')
    .trim();
}
function normalizedStringList(values: string[] | undefined): string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
}
function parseStoredList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
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
    configService: ConfigService,
    @InjectRepository(TeachingResource)
    private readonly resourceRepository: Repository<TeachingResource>,
  ) {
    const configuredPath = configService
      .get<string>('RESOURCE_LIBRARY_PATH')
      ?.trim();
    const candidates = [
      configuredPath,
      join(process.cwd(), 'test-resources'),
      join(process.cwd(), '..', 'test-resources'),
    ].filter((value): value is string => Boolean(value));
    this.libraryDirectory =
      candidates.find((candidate) => existsSync(resolve(candidate))) ??
      resolve(candidates[0] ?? join(process.cwd(), 'test-resources'));
    this.sharedOwnerId =
      configService.get<string>('GARDEN_SHARED_OWNER_ID')?.trim() ||
      'garden:shared';
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
    teacherId?: number,
    query?: ListResourceQueryDto,
  ): Promise<PaginatedResources | PersonalResource[]> {
    if (teacherId === undefined || query === undefined) {
      return (await this.scanLegacyLibrary()).map(
        ({ absolutePath: _absolutePath, ...resource }) => resource,
      );
    }
    const builder = this.resourceRepository
      .createQueryBuilder('resource')
      .where(
        `((resource.owner_type = :ownerType AND resource.owner_id = :ownerId)
          OR (resource.owner_type = :ownerType AND resource.owner_id = :sharedOwnerId
            AND resource.review_status = :approved))`,
        {
          ownerType: OwnerType.Teacher,
          ownerId: String(teacherId),
          sharedOwnerId: this.sharedOwnerId,
          approved: ResourceReviewStatus.Approved,
        },
      );
    if (query.category)
      builder.andWhere('resource.category = :category', {
        category: query.category,
      });
    if (query.resourceType)
      builder.andWhere('resource.resource_type = :resourceType', {
        resourceType: query.resourceType,
      });
    if (query.ageGroup)
      builder.andWhere('resource.age_group = :ageGroup', {
        ageGroup: query.ageGroup,
      });
    if (query.keyword?.trim()) {
      const keyword = `%${this.escapeLike(query.keyword.trim())}%`;
      builder.andWhere(
        "(resource.title LIKE :keyword ESCAPE '\\' OR resource.aliases LIKE :keyword ESCAPE '\\' OR resource.tags LIKE :keyword ESCAPE '\\')",
        { keyword },
      );
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await builder
      .orderBy('resource.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize,
    };
  }

  async search(
    teacherId: number,
    keyword: string,
    resourceType?: ResourceType,
  ): Promise<ResourceSearchResult[]> {
    const normalizedKeyword = normalizeText(keyword.trim());
    if (!normalizedKeyword) throw new BadRequestException('搜索关键词不能为空');
    const page = await this.list(teacherId, {
      keyword,
      resourceType,
      page: 1,
      pageSize: 100,
    });
    return page.items
      .map((resource) => ({
        ...resource,
        score: this.searchScore(resource, normalizedKeyword),
      }))
      .filter((resource) => resource.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.createdAt.getTime() - left.createdAt.getTime(),
      );
  }

  async getOne(teacherId: number, id: number): Promise<ResourceResponse> {
    const entity = await this.resourceRepository.findOne({
      where: [
        { id, ownerType: OwnerType.Teacher, ownerId: String(teacherId) },
        {
          id,
          ownerType: OwnerType.Teacher,
          ownerId: this.sharedOwnerId,
          reviewStatus: ResourceReviewStatus.Approved,
        },
      ],
    });
    if (!entity) throw new NotFoundException('资源不存在或无权访问');
    return this.toResponse(entity);
  }

  async upload(
    teacherId: number,
    dto: UploadResourceDto,
    file?: Express.Multer.File,
  ): Promise<ResourceResponse> {
    try {
      const rule = validateUploadedFile(file);
      const uploadedFile = file!;
      const entity = this.resourceRepository.create({
        title: dto.title.trim(),
        aliases: JSON.stringify(normalizedStringList(dto.aliases)),
        description: dto.description?.trim() || null,
        resourceType: rule.resourceType,
        category: dto.category.trim(),
        ageGroup: dto.ageGroup,
        tags: JSON.stringify(normalizedStringList(dto.tags)),
        fileUrl: `/uploads/resources/${uploadedFile.filename}`,
        coverUrl: null,
        fileName: uploadedFile.originalname,
        mimeType: uploadedFile.mimetype,
        fileSize: uploadedFile.size,
        duration: dto.duration ?? null,
        reviewStatus: ResourceReviewStatus.Pending,
        ownerType: OwnerType.Teacher,
        ownerId: String(teacherId),
      });
      const saved = await this.resourceRepository.save(entity);
      this.logger.log(
        `resource.upload teacher=${teacherId} resource=${saved.id} type=${saved.resourceType} size=${saved.fileSize}`,
      );
      return this.toResponse(saved);
    } catch (error) {
      if (file?.path) await this.safeUnlink(file.path);
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `resource.upload.failed teacher=${teacherId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('资源上传失败，请稍后重试');
    }
  }

  async update(
    actor: JwtTeacherPayload,
    id: number,
    dto: UpdateResourceDto,
  ): Promise<ResourceResponse> {
    const entity = await this.findManageable(actor, id);
    if (dto.title !== undefined) entity.title = dto.title.trim();
    if (dto.aliases !== undefined)
      entity.aliases = JSON.stringify(normalizedStringList(dto.aliases));
    if (dto.description !== undefined)
      entity.description = dto.description.trim() || null;
    if (dto.category !== undefined) entity.category = dto.category.trim();
    if (dto.ageGroup !== undefined) entity.ageGroup = dto.ageGroup;
    if (dto.tags !== undefined)
      entity.tags = JSON.stringify(normalizedStringList(dto.tags));
    const saved = await this.resourceRepository.save(entity);
    this.logger.log(`resource.update teacher=${actor.sub} resource=${id}`);
    return this.toResponse(saved);
  }

  async remove(actor: JwtTeacherPayload, id: number): Promise<void> {
    const entity = await this.findManageable(actor, id);
    const physicalPath = this.resolveManagedFile(entity.fileUrl);
    if (physicalPath) await this.safeUnlink(physicalPath, true);
    await this.resourceRepository.remove(entity);
    this.logger.log(`resource.delete teacher=${actor.sub} resource=${id}`);
  }

  async getFile(id: string): Promise<{ path: string; size: number }> {
    const resource = (await this.scanLegacyLibrary()).find(
      (item) => item.id === id,
    );
    if (!resource) throw new NotFoundException('资源不存在或已被移动');
    const fileStat = await stat(resource.absolutePath);
    return { path: resource.absolutePath, size: fileStat.size };
  }

  async handleCommand(text: string): Promise<ResourceCommandResult | null> {
    const wantsPlay = PLAY_INTENT.test(text);
    const wantsSearch = SEARCH_INTENT.test(text);
    if (!wantsPlay && !wantsSearch) return null;
    const resources = (await this.scanLegacyLibrary()).map(
      ({ absolutePath: _absolutePath, ...resource }) => resource,
    );
    const normalizedInput = normalizeText(text);
    const scored = resources
      .map((resource) => {
        const matches = [resource.title, ...resource.aliases]
          .map(normalizeText)
          .filter(
            (candidate) => candidate && normalizedInput.includes(candidate),
          );
        return {
          resource,
          score: Math.max(0, ...matches.map((match) => match.length)),
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!scored.length) {
      if (!RESOURCE_WORD.test(text)) return null;
      return {
        reply: '我在个人资源中没有找到这个内容。你可以试试说完整的资源名称。',
      };
    }
    const bestScore = scored[0]?.score ?? 0;
    const bestMatches = scored.filter((item) => item.score === bestScore);
    if (bestMatches.length > 1) {
      const names = bestMatches
        .slice(0, 3)
        .map(({ resource }) => `《${resource.title}》`)
        .join('、');
      return { reply: `找到了几个相似资源：${names}。请告诉我你想要哪一个。` };
    }
    const resource = bestMatches[0]!.resource;
    if (wantsPlay && resource.mediaType === 'audio') {
      return {
        reply: `已为你播放《${resource.title}》。`,
        action: { type: 'play', resource },
      };
    }
    return {
      reply: `已找到《${resource.title}》，位于个人资源的“${resource.category}”分类中。`,
    };
  }

  private async findOwned(
    teacherId: number,
    id: number,
  ): Promise<TeachingResource> {
    const entity = await this.resourceRepository.findOne({
      where: { id, ownerType: OwnerType.Teacher, ownerId: String(teacherId) },
    });
    if (!entity) throw new NotFoundException('资源不存在或无权访问');
    return entity;
  }

  private async findManageable(
    actor: JwtTeacherPayload,
    id: number,
  ): Promise<TeachingResource> {
    if (actor.role !== TeacherRole.Admin) return this.findOwned(actor.sub, id);
    const entity = await this.resourceRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('资源不存在');
    return entity;
  }

  private toResponse(entity: TeachingResource): ResourceResponse {
    return {
      id: entity.id,
      title: entity.title,
      aliases: parseStoredList(entity.aliases),
      description: entity.description,
      resourceType: entity.resourceType,
      category: entity.category,
      ageGroup: entity.ageGroup,
      tags: parseStoredList(entity.tags),
      fileUrl: entity.fileUrl,
      coverUrl: entity.coverUrl,
      fileName: entity.fileName,
      mimeType: entity.mimeType,
      fileSize: entity.fileSize,
      duration: entity.duration,
      reviewStatus: entity.reviewStatus,
      ownerType: entity.ownerType,
      ownerId: entity.ownerId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private searchScore(resource: ResourceResponse, keyword: string): number {
    const title = normalizeText(resource.title);
    if (title === keyword) return 1000;
    const aliases = resource.aliases.map(normalizeText);
    if (aliases.includes(keyword)) return 900;
    const tags = resource.tags.map(normalizeText);
    if (tags.includes(keyword)) return 800;
    if (title.includes(keyword)) return 700;
    if (aliases.some((value) => value.includes(keyword))) return 600;
    if (tags.some((value) => value.includes(keyword))) return 500;
    return 0;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }

  private resolveManagedFile(fileUrl: string): string | null {
    const prefix = '/uploads/resources/';
    if (!fileUrl.startsWith(prefix)) return null;
    const fileName = fileUrl.slice(prefix.length);
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
      throw new InternalServerErrorException('资源文件路径无效');
    }
    const filePath = resolve(RESOURCE_UPLOAD_DIRECTORY, fileName);
    const relation = relative(RESOURCE_UPLOAD_DIRECTORY, filePath);
    if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
      throw new InternalServerErrorException('资源文件路径无效');
    }
    return filePath;
  }

  private async safeUnlink(
    filePath: string,
    failOnError = false,
  ): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.logger.error(
        `resource.file.delete.failed path=${filePath}`,
        error instanceof Error ? error.stack : String(error),
      );
      if (failOnError)
        throw new InternalServerErrorException('资源文件删除失败，请稍后重试');
    }
  }

  private async scanLegacyLibrary(): Promise<ResourceRecord[]> {
    if (!existsSync(this.libraryDirectory)) return [];
    const entries = await readdir(this.libraryDirectory, {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => this.toLegacyResource(entry.name))
      .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
  }

  private toLegacyResource(fileName: string): ResourceRecord {
    const mediaType =
      EXTENSION_MEDIA_TYPES[extname(fileName).toLocaleLowerCase()] ?? 'other';
    const bvid = fileName.match(/\[(BV[a-zA-Z0-9]+)]/)?.[1];
    const metadata = bvid ? SONG_METADATA[bvid] : undefined;
    const title = metadata?.title || cleanFileTitle(fileName) || fileName;
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
}
