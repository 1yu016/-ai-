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
  ListResourceQueryDto,
  SearchResourceQueryDto,
  UpdateResourceDto,
  UploadResourceDto,
} from './dto/resource.dto';
import { resourceMulterOptions } from './resource-file.validation';
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
    return this.resourceService.upload(request.user.sub, dto, file);
  }

  @Get()
  @UseGuards(AuthGuard)
  list(
    @Query() query: ListResourceQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PaginatedResources> {
    return this.resourceService.list(request.user.sub, query);
  }

  @Get('search')
  @UseGuards(AuthGuard)
  search(
    @Query() query: SearchResourceQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ResourceSearchResult[]> {
    return this.resourceService.search(
      request.user.sub,
      query.keyword,
      query.resourceType,
    );
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
    return this.resourceService.getOne(request.user.sub, id);
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
