import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TeachingResource } from '../data/entities/teaching-resource.entity';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';
import { ResourceUploadExceptionFilter } from './resource-upload-exception.filter';

@Module({
  imports: [TypeOrmModule.forFeature([TeachingResource]), AuthModule],
  controllers: [ResourceController],
  providers: [ResourceService, ResourceUploadExceptionFilter],
  exports: [ResourceService],
})
export class ResourceModule {}
