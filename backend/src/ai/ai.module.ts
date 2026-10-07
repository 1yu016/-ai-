import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClassroomRunModule } from '../classroom-runs/classroom-run.module';
import { DataModule } from '../data/data.module';
import { PlatformModule } from '../platform/platform.module';
import { ResourceModule } from '../resources/resource.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AudioService } from './audio.service';
import { ClassroomDirectorService } from './classroom-director.service';
import { ClassroomDirectorSuggestion } from './entities/classroom-director-suggestion.entity';
import { TeacherCommandSynonym } from './entities/teacher-command-synonym.entity';
import { CommandSynonymService } from './command-synonym.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClassroomDirectorSuggestion, TeacherCommandSynonym]),
    AuthModule,
    DataModule,
    ResourceModule,
    PlatformModule,
    ClassroomRunModule,
  ],
  controllers: [AiController],
  providers: [AiService, AudioService, ClassroomDirectorService, CommandSynonymService],
})
export class AiModule {}
