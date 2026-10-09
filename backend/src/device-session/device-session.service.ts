import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { DeviceBinding } from '../platform/entities/device-binding.entity';
import { Device } from '../platform/entities/device.entity';
import { PlatformAccessService } from '../platform/platform-access.service';
import { BindingStatus, DeviceStatus } from '../platform/platform.types';
import { DeviceSession } from './entities/device-session.entity';

@Injectable()
export class DeviceSessionService {
  private readonly sessionTtlMs: number;

  constructor(
    @InjectRepository(DeviceSession)
    private readonly sessions: Repository<DeviceSession>,
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
    @InjectRepository(DeviceBinding)
    private readonly bindings: Repository<DeviceBinding>,
    private readonly access: PlatformAccessService,
    private readonly config: ConfigService,
  ) {
    this.sessionTtlMs = Math.max(
      60_000,
      Number(this.config.get<string>('DEVICE_SESSION_TTL_MS') || 24 * 60 * 60 * 1000),
    );
  }

  /**
   * 教师引导签发：Teacher Identity 负责绑定/管理设备。
   * 校验教师对设备 active binding 的班级访问权 → 签发受限 Device Session Token。
   */
  async issue(actor: JwtTeacherPayload, deviceId: number) {
    const device = await this.devices.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('设备不存在');
    const binding = await this.bindings.findOne({
      where: { deviceId, status: BindingStatus.Active },
    });
    if (!binding)
      throw new ConflictException('设备尚未绑定到有效班级，无法签发设备凭证');

    // requireClassAccess 覆盖班级访问权限与同园所校验。
    await this.access.requireClassAccess(actor, binding.classId);
    if (actor.schoolId && device.schoolId && actor.schoolId !== device.schoolId)
      throw new ForbiddenException('设备不属于当前园所');
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      throw new ConflictException('停用或故障设备不能参与课堂');

    // 旋转：撤销该设备已有的全部未撤销会话，避免凭证堆积。
    await this.sessions.update(
      { deviceId, revokedAt: IsNull() },
      {
        revokedAt: new Date(),
        revokeReason: 'rotated',
      },
    );

    const rawToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const saved = await this.sessions.save(
      this.sessions.create({
        deviceId,
        tokenHash: this.hash(rawToken),
        schoolId: device.schoolId,
        classId: binding.classId,
        expiresAt: new Date(now.getTime() + this.sessionTtlMs),
        lastHeartbeatAt: now,
        revokedAt: null,
        revokeReason: null,
      }),
    );
    // raw token 只返回一次，DB 仅存 hash。
    return {
      deviceId,
      token: rawToken,
      id: saved.id,
      expiresAt: saved.expiresAt,
    };
  }

  /**
   * 设备心跳：Device Identity 负责维持 online。
   * 仅凭 x-device-session token，不依赖 teacher JWT。
   */
  async heartbeat(rawToken: string) {
    if (!rawToken?.trim())
      throw new UnauthorizedException('设备凭证无效');
    const session = await this.sessions.findOne({
      where: { tokenHash: this.hash(rawToken.trim()) },
    });
    if (!session) throw new UnauthorizedException('设备凭证无效');
    if (session.revokedAt)
      throw new UnauthorizedException('设备凭证已失效');
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions.update(session.id, {
        revokedAt: new Date(),
        revokeReason: 'expired',
      });
      throw new GoneException('设备凭证已过期');
    }

    const device = await this.devices.findOne({
      where: { id: session.deviceId },
    });
    if (!device) throw new NotFoundException('设备不存在');

    const binding = await this.bindings.findOne({
      where: { deviceId: device.id, status: BindingStatus.Active },
    });
    if (!binding) throw new ConflictException('设备绑定已撤销');
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      throw new ConflictException(
        device.status === DeviceStatus.Disabled ? '设备已停用' : '设备故障',
      );

    const now = new Date();
    device.lastOnlineAt = now;
    device.status = DeviceStatus.Online;
    await this.devices.save(device);
    await this.sessions.update(session.id, { lastHeartbeatAt: now });

    return {
      deviceId: device.id,
      online: true,
      status: DeviceStatus.Online,
      lastOnlineAt: now.toISOString(),
    };
  }

  async revokeForDevice(deviceId: number, reason = 'binding_revoked') {
    await this.sessions.update(
      { deviceId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokeReason: reason.slice(0, 120) },
    );
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}