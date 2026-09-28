import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { avatarMulterOptions } from './avatar-file.validation';
import { AvatarUploadExceptionFilter } from './avatar-upload-exception.filter';
import { AvatarService } from './avatar.service';
import {
  CreateAvatarCharacterDto,
  CreateAvatarVersionDto,
  DisableAvatarVersionDto,
  ListAvatarCharacterQueryDto,
  ReviewAvatarCharacterDto,
  UpdateAvatarCharacterDto,
  UploadAvatarAssetDto,
} from './dto/avatar.dto';

@Controller('avatars')
@UseGuards(AuthGuard)
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Post('characters')
  createCharacter(
    @Body() dto: CreateAvatarCharacterDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.createCharacter(request.user, dto);
  }

  @Get('characters')
  listCharacters(
    @Query() query: ListAvatarCharacterQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.list(request.user, query);
  }

  @Get('characters/:id')
  getCharacter(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.get(request.user, id);
  }

  @Patch('characters/:id')
  updateCharacter(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAvatarCharacterDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.updateCharacter(request.user, id, dto);
  }

  @Post('characters/:id/versions')
  @UseFilters(AvatarUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', avatarMulterOptions))
  createVersion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAvatarVersionDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.createVersion(request.user, id, dto, file);
  }

  @Post('versions/:id/assets')
  @UseFilters(AvatarUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', avatarMulterOptions))
  uploadAsset(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UploadAvatarAssetDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.uploadAsset(request.user, id, dto, file);
  }

  @Get('versions/:id/integrity')
  integrity(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.checkIntegrity(request.user, id);
  }

  @Post('versions/:id/publish')
  publish(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.publishVersion(request.user, id);
  }

  @Delete('versions/:id')
  removeVersion(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.removeVersion(request.user, id);
  }

  @Post('characters/:id/submit-review')
  submitReview(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.submitReview(request.user, id);
  }

  @Post('characters/:id/review')
  reviewCharacter(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewAvatarCharacterDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.reviewCharacter(request.user, id, dto);
  }

  @Patch('versions/:id/status')
  setVersionStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DisableAvatarVersionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.avatars.setVersionStatus(request.user, id, dto);
  }

  @Get('assets/:id/content')
  async content(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.avatars.downloadAsset(request.user, id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.size));
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(file.path));
  }
}
