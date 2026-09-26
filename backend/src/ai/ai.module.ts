import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataModule } from '../data/data.module';
import { ResourceModule } from '../resources/resource.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AudioService } from './audio.service';

@Module({
  imports: [AuthModule, DataModule, ResourceModule],
  controllers: [AiController],
  providers: [AiService, AudioService],
})
export class AiModule {}
