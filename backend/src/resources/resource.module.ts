import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TeachingResource } from '../data/entities/teaching-resource.entity';
import { PlatformModule } from '../platform/platform.module';
import { ResourceCategory } from './entities/resource-category.entity';
import { ResourceFavorite } from './entities/resource-favorite.entity';
import { ResourceReference } from './entities/resource-reference.entity';
import { ResourceReview } from './entities/resource-review.entity';
import {
  ResourceTag,
  ResourceTagRelation,
} from './entities/resource-tag.entity';
import { ResourceVersion } from './entities/resource-version.entity';
import { UploadChunk, UploadSession } from './entities/upload-session.entity';
import { ResourceAiService } from './resource-ai.service';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';
import { ResourceUploadExceptionFilter } from './resource-upload-exception.filter';

export const RESOURCE_ENTITIES = [
  ResourceCategory,
  ResourceVersion,
  ResourceTag,
  ResourceTagRelation,
  ResourceFavorite,
  ResourceReference,
  ResourceReview,
  UploadSession,
  UploadChunk,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([TeachingResource, ...RESOURCE_ENTITIES]),
    AuthModule,
    PlatformModule,
  ],
  controllers: [ResourceController],
  providers: [
    ResourceService,
    ResourceAiService,
    ResourceUploadExceptionFilter,
  ],
  exports: [ResourceService],
})
export class ResourceModule {}
