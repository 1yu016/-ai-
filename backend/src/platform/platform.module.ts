import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Teacher } from '../auth/entities/teacher.entity';
import { AiCallLog } from './entities/ai-call-log.entity';
import { AuditLog } from './entities/audit-log.entity';
import { ClassroomTicket } from './entities/classroom-ticket.entity';
import { Classroom } from './entities/classroom.entity';
import { DeviceBinding } from './entities/device-binding.entity';
import { Device } from './entities/device.entity';
import { GuardianConsent } from './entities/guardian-consent.entity';
import { SchoolClass } from './entities/school-class.entity';
import { Student } from './entities/student.entity';
import { TeacherClass } from './entities/teacher-class.entity';
import { AuditService } from './audit.service';
import {
  ClassroomTicketPublicController,
  PlatformController,
} from './platform.controller';
import { PlatformAccessService } from './platform-access.service';
import { PlatformService } from './platform.service';

export const PLATFORM_ENTITIES = [
  SchoolClass,
  TeacherClass,
  Student,
  Classroom,
  Device,
  DeviceBinding,
  ClassroomTicket,
  GuardianConsent,
  AuditLog,
  AiCallLog,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([Teacher, ...PLATFORM_ENTITIES]),
    AuthModule,
  ],
  controllers: [PlatformController, ClassroomTicketPublicController],
  providers: [PlatformService, PlatformAccessService, AuditService],
  exports: [
    PlatformService,
    PlatformAccessService,
    AuditService,
    TypeOrmModule,
  ],
})
export class PlatformModule {}
