import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { Device } from '../platform/entities/device.entity';
import { PlatformModule } from '../platform/platform.module';
import {
  DeviceSessionHeartbeatController,
  DeviceSessionIssueController,
} from './device-session.controller';
import { DeviceSessionService } from './device-session.service';
import { DeviceSession } from './entities/device-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeviceSession, Device, DeviceBinding]),
    AuthModule,
    PlatformModule,
  ],
  controllers: [
    DeviceSessionIssueController,
    DeviceSessionHeartbeatController,
  ],
  providers: [DeviceSessionService],
  exports: [DeviceSessionService],
})
export class DeviceSessionModule {}