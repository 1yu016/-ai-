import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  ChunkHashDto,
  ConfirmAiSuggestionDto,
  CreateCategoryDto,
  CreateUploadSessionDto,
  ListResourceQueryDto,
  ResourceReferenceDto,
  ResourceReviewDto,
  SearchResourceQueryDto,
  UpdateResourceDto,
  UploadResourceDto,
} from './dto/resource.dto';
import { resourceMulterOptions } from './resource-file.validation';
import { chunkMulterOptions } from './resource-file.validation';
import { ResourceUploadExceptionFilter } from './resource-upload-exception.filter';
import {
  type PaginatedResources,
  type ResourceResponse,
  type ResourceSearchResult,
  ResourceService,
} from './resource.service';

@Controller('resources')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Post('upload')
  @UseGuards(AuthGuard)
  @UseFilters(ResourceUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', resourceMulterOptions))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadResourceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ResourceResponse> {
    return this.resourceService.upload(request.user, dto, file);
  }

  @Get()
  @UseGuards(AuthGuard)
  list(
    @Query() query: ListResourceQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PaginatedResources> {
    return this.resourceService.list(request.user, query);
  }

  @Get('search')
  @UseGuards(AuthGuard)
  search(
    @Query() query: SearchResourceQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ResourceSearchResult[]> {
    return this.resourceService.search(
      request.user,
      query.keyword,
      query.resourceType,
    );
  }

  @Post('categories')
  @UseGuards(AuthGuard)
  createCategory(
    @Body() dto: CreateCategoryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.createCategory(request.user, dto);
  }

  @Get('categories')
  @UseGuards(AuthGuard)
  listCategories() {
    return this.resourceService.listCategories();
  }

  @Post('upload-sessions')
  @UseGuards(AuthGuard)
  createUploadSession(
    @Body() dto: CreateUploadSessionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.createUploadSession(request.user, dto);
  }

  @Get('upload-sessions/:id/chunks')
  @UseGuards(AuthGuard)
  listChunks(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.resourceService.listUploadedChunks(request.user, id);
  }

  @Post('upload-sessions/:id/chunks/:chunkNo')
  @UseGuards(AuthGuard)
  @UseFilters(ResourceUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', chunkMulterOptions))
  uploadChunk(
    @Param('id') id: string,
    @Param('chunkNo', ParseIntPipe) chunkNo: number,
    @Body() dto: ChunkHashDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.uploadChunk(
      request.user,
      id,
      chunkNo,
      dto.sha256,
      file,
    );
  }

  @Post('upload-sessions/:id/complete')
  @UseGuards(AuthGuard)
  completeUpload(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.completeUpload(request.user, id);
  }

  @Delete('upload-sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  abortUpload(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.resourceService.abortUpload(request.user, id);
  }

  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.resourceService.getFile(id);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', 'audio/mpeg');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    const match = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const requestedStart = Number(match[1] || 0);
      const requestedEnd = Number(match[2] || file.size - 1);
      const start = Math.max(0, Math.min(requestedStart, file.size - 1));
      const end = Math.max(start, Math.min(requestedEnd, file.size - 1));
      response.status(206);
      response.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      response.setHeader('Content-Length', String(end - start + 1));
      return new StreamableFile(createReadStream(file.path, { start, end }));
    }
    response.setHeader('Content-Length', String(file.size));
    return new StreamableFile(createReadStream(file.path));
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  getOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<ResourceResponse> {
    return this.resourceService.getOne(request.user, id);
  }

  @Get(':id/download')
  @UseGuards(AuthGuard)
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.resourceService.download(request.user, id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.size));
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(file.path));
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResourceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ResourceResponse> {
    return this.resourceService.update(request.user, id, dto);
  }

  @Post(':id/versions')
  @UseGuards(AuthGuard)
  @UseFilters(ResourceUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', resourceMulterOptions))
  addVersion(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.addVersion(request.user, id, file);
  }

  @Post(':id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  favorite(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.favorite(request.user, id);
  }

  @Delete(':id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  unfavorite(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.unfavorite(request.user, id);
  }

  @Post(':id/references')
  @UseGuards(AuthGuard)
  addReference(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResourceReferenceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.addReference(request.user, id, dto);
  }

  @Delete(':id/references')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  removeReference(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResourceReferenceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.removeReference(request.user, id, dto);
  }

  @Post(':id/submit-review')
  @UseGuards(AuthGuard)
  submitReview(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.submitReview(request.user, id);
  }

  @Post(':id/review')
  @UseGuards(AuthGuard)
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResourceReviewDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.review(request.user, id, dto);
  }

  @Post(':id/ai-suggestion')
  @UseGuards(AuthGuard)
  aiSuggestion(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.aiSuggestion(request.user, id);
  }

  @Post(':id/ai-suggestion/confirm')
  @UseGuards(AuthGuard)
  confirmAiSuggestion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmAiSuggestionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resourceService.confirmAiSuggestion(request.user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.resourceService.remove(request.user, id);
  }
}
