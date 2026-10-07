import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req, Res, StreamableFile, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ArtworkService } from './artwork.service';
import { artworkMulterOptions } from './artwork-file';
import { ArtworkUploadExceptionFilter } from './artwork-upload-exception.filter';
import { ArtworkListQueryDto, ArtworkReviewDto, ConfirmArtworkDto, DeliverArtworkDto, UploadArtworkDto } from './dto/artwork.dto';

@Controller()
@UseGuards(AuthGuard)
export class ArtworkController {
  constructor(private readonly artworks: ArtworkService) {}

  @Post('classroom-runs/:runId/artworks')
  @UseFilters(ArtworkUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', artworkMulterOptions))
  upload(@Req() req: AuthenticatedRequest, @Param('runId', ParseIntPipe) runId: number, @Body() dto: UploadArtworkDto, @UploadedFile() file?: Express.Multer.File) {
    return this.artworks.upload(req.user, runId, dto, file);
  }

  @Get('classroom-runs/:runId/artworks')
  listRun(@Req() req: AuthenticatedRequest, @Param('runId', ParseIntPipe) runId: number, @Query() query: ArtworkListQueryDto) {
    return this.artworks.listRun(req.user, runId, query);
  }

  @Get('classes/:classId/artworks')
  listClass(@Req() req: AuthenticatedRequest, @Param('classId', ParseIntPipe) classId: number, @Query() query: ArtworkListQueryDto) {
    return this.artworks.listClass(req.user, classId, query);
  }

  @Post('ai/artwork-review')
  @HttpCode(HttpStatus.OK)
  review(@Req() req: AuthenticatedRequest, @Body() dto: ArtworkReviewDto) {
    return this.artworks.generateDraft(req.user, dto.artworkId);
  }

  @Post('artworks/:artworkId/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@Req() req: AuthenticatedRequest, @Param('artworkId', ParseIntPipe) artworkId: number, @Body() dto: ConfirmArtworkDto) {
    return this.artworks.confirm(req.user, artworkId, dto.teacherComment);
  }

  @Post('artworks/:artworkId/deliver')
  @HttpCode(HttpStatus.OK)
  deliver(@Req() req: AuthenticatedRequest, @Param('artworkId', ParseIntPipe) artworkId: number, @Body() dto: DeliverArtworkDto) {
    return this.artworks.deliver(req.user, artworkId, dto);
  }

  @Get('artworks/:artworkId/file')
  @Header('Cache-Control', 'private, max-age=300')
  async file(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) response: Response, @Param('artworkId', ParseIntPipe) artworkId: number) {
    const result = await this.artworks.file(req.user, artworkId);
    response.setHeader('Content-Type', result.artwork.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="artwork-${result.artwork.id}"`);
    return new StreamableFile(createReadStream(result.path));
  }
}
