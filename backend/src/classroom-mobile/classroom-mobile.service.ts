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
import {
  catchError,
  concatMap,
  from,
  map,
  Observable,
  of,
  timer,
} from 'rxjs';
import { In, Repository } from 'typeorm';
import type { JwtTeacherPayload } from '../auth/auth.types';
import { AuthUserType } from '../auth/entities/refresh-token-session.entity';
import { AttendanceService } from '../classroom-runs/attendance.service';
import { ClassroomCommandService } from '../classroom-runs/classroom-command.service';
import {
  ClassroomCommandSource,
} from '../classroom-runs/classroom-command.types';
import { ClassroomRunService } from '../classroom-runs/classroom-run.service';
import { TERMINAL_CLASSROOM_RUN_STATUSES } from '../classroom-runs/classroom-run.types';
import { ExecuteClassroomCommandDto } from '../classroom-runs/dto/classroom-command.dto';
import { ClassroomRollCallRecord } from '../classroom-runs/entities/classroom-roll-call-record.entity';
import { ClassroomRun } from '../classroom-runs/entities/classroom-run.entity';
import { StudentRewardRecord } from '../classroom-runs/entities/student-reward-record.entity';
import { Device } from '../platform/entities/device.entity';
import { Student } from '../platform/entities/student.entity';
import { DeviceStatus } from '../platform/platform.types';
import { PlatformService } from '../platform/platform.service';
import {
  ExecuteMobileClassroomCommandDto,
  JoinClassroomMobileDto,
} from './dto/classroom-mobile.dto';
import { ClassroomControlSession } from './entities/classroom-control-session.entity';

type MobileStreamEvent = { type: string; data: unknown };

@Injectable()
export class ClassroomMobileService {
  private readonly sessionTtlMs: number;
  private readonly heartbeatTimeoutMs: number;

  constructor(
    @InjectRepository(ClassroomControlSession)
    private readonly sessions: Repository<ClassroomControlSession>,
    @InjectRepository(ClassroomRun)
    private readonly runRepository: Repository<ClassroomRun>,
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
    @InjectRepository(ClassroomRollCallRecord)
    private readonly rollCalls: Repository<ClassroomRollCallRecord>,
    @InjectRepository(StudentRewardRecord)
    private readonly rewards: Repository<StudentRewardRecord>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly platform: PlatformService,
    private readonly runs: ClassroomRunService,
    private readonly attendance: AttendanceService,
    private readonly commands: ClassroomCommandService,
    private readonly config: ConfigService,
  ) {
    this.sessionTtlMs = Math.max(
      60_000,
      Number(this.config.get<string>('CLASSROOM_MOBILE_SESSION_TTL_MS') || 8 * 60 * 60 * 1000),
    );
    this.heartbeatTimeoutMs = Math.max(
      10_000,
      Number(this.config.get<string>('DEVICE_HEARTBEAT_TIMEOUT_MS') || 90_000),
    );
  }

  async join(actor: JwtTeacherPayload, dto: JoinClassroomMobileDto) {
    this.requireTeacher(actor);
    const context = await this.platform.consumeTicket(
      actor,
      dto.ticket,
      dto.deviceCode,
    );
    if (!context.lessonRunId) return { ...context, controlSession: null };

    const run = await this.runRepository.findOne({
      where: { id: context.lessonRunId },
    });
    if (!run || run.teacherId !== actor.sub)
      throw new ForbiddenException('只有当前课堂教师可以连接手机控制端');
    this.assertRunActive(run);
    const rawToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const session = await this.sessions.save(
      this.sessions.create({
        tokenHash: this.hash(rawToken),
        classroomRunId: run.id,
        teacherId: actor.sub,
        classId: run.classId,
        screenDeviceId: run.deviceId,
        expiresAt: new Date(now.getTime() + this.sessionTtlMs),
        lastHeartbeatAt: now,
        revokedAt: null,
        revokeReason: null,
      }),
    );
    return {
      ...context,
      controlSession: {
        id: session.id,
        token: rawToken,
        classroomRunId: session.classroomRunId,
        targetDeviceId: session.screenDeviceId,
        expiresAt: session.expiresAt,
      },
    };
  }

  async heartbeat(actor: JwtTeacherPayload, rawToken: string) {
    const { session } = await this.requireSession(actor, rawToken);
    const now = new Date();
    await this.sessions.update(session.id, { lastHeartbeatAt: now });
    return { ok: true, serverNow: now.toISOString(), expiresAt: session.expiresAt };
  }

  async revoke(actor: JwtTeacherPayload, rawToken: string, reason = 'teacher_logout') {
    const { session } = await this.requireSession(actor, rawToken, true);
    if (!session.revokedAt)
      await this.sessions.update(session.id, {
        revokedAt: new Date(),
        revokeReason: reason.slice(0, 120),
      });
    return { success: true };
  }

  async state(actor: JwtTeacherPayload, rawToken: string) {
    const { session, run } = await this.requireSession(actor, rawToken);
    const classroomState = await this.runs.restore(
      actor,
      run.id,
      session.screenDeviceId,
    );
    const [device, attendance, recentRollCall, recentReward] = await Promise.all([
      this.devices.findOne({ where: { id: session.screenDeviceId } }),
      this.attendance.list(actor, run.id),
      this.rollCalls.findOne({
        where: { classroomRunId: run.id },
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
      this.rewards.findOne({
        where: { classroomRunId: run.id },
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
    ]);
    const studentIds = [recentRollCall?.studentId, recentReward?.studentId].filter(
      (id): id is number => Number.isInteger(id),
    );
    const students = studentIds.length
      ? await this.students.find({ where: { id: In(studentIds) } })
      : [];
    const displayName = new Map(
      students.map((student) => [student.id, student.nickname || student.name]),
    );
    const screenOnline = this.isDeviceOnline(device);
    return {
      controlActive: true,
      serverNow: new Date().toISOString(),
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
      },
      classroom: classroomState,
      screen: {
        deviceId: session.screenDeviceId,
        online: screenOnline,
        status: device?.status ?? DeviceStatus.Offline,
        lastOnlineAt: device?.lastOnlineAt ?? null,
      },
      attendance,
      recentRollCall: recentRollCall
        ? {
            id: recentRollCall.id,
            studentId: recentRollCall.studentId,
            displayName: displayName.get(recentRollCall.studentId) ?? '幼儿',
            mode: recentRollCall.mode,
            createdAt: recentRollCall.createdAt,
          }
        : null,
      recentReward: recentReward
        ? {
            id: recentReward.id,
            studentId: recentReward.studentId,
            displayName: displayName.get(recentReward.studentId) ?? '幼儿',
            category: recentReward.rewardCategory,
            points: recentReward.points,
            stars: recentReward.stars,
            revokedAt: recentReward.revokedAt,
            createdAt: recentReward.createdAt,
          }
        : null,
      interaction: classroomState.interactionState ?? {},
    };
  }

  stream(actor: JwtTeacherPayload, rawToken: string): Observable<MobileStreamEvent> {
    return timer(0, 1000).pipe(
      concatMap(() => from(this.state(actor, rawToken))),
      map((data) => ({ type: 'state', data })),
      catchError((error: unknown) =>
        of({
          type: 'session_invalid',
          data: { message: this.errorMessage(error) },
        }),
      ),
    );
  }

  screenStream(actor: JwtTeacherPayload, deviceId: number): Observable<MobileStreamEvent> {
    return timer(0, 750).pipe(
      concatMap(() => from(this.runs.screenState(actor, deviceId))),
      map((data) => ({ type: 'screen_state', data })),
      catchError((error: unknown) =>
        of({ type: 'screen_error', data: { message: this.errorMessage(error) } }),
      ),
    );
  }

  async execute(
    actor: JwtTeacherPayload,
    rawToken: string,
    dto: ExecuteMobileClassroomCommandDto,
  ) {
    const { session, run } = await this.requireSession(actor, rawToken);
    if (dto.targetDeviceId !== session.screenDeviceId)
      throw new ForbiddenException('指令目标不是当前课堂大屏');
    const device = await this.devices.findOne({
      where: { id: session.screenDeviceId },
    });
    if (!this.isDeviceOnline(device))
      throw new ConflictException('大屏离线，指令未执行');
    const command = Object.assign(new ExecuteClassroomCommandDto(), {
      requestId: dto.requestId,
      runId: run.id,
      deviceId: session.screenDeviceId,
      expectedVersion: dto.expectedVersion,
      source: ClassroomCommandSource.Mobile,
      operation: dto.operation,
      targetDeviceId: dto.targetDeviceId,
      parameters: dto.parameters,
      issuedAt: dto.issuedAt,
      ttlMs: dto.ttlMs,
    });
    const result = await this.commands.executeFromMobileSession(actor, command);
    return { deliveryStatus: 'confirmed', confirmedAt: new Date().toISOString(), result };
  }

  async discovery(deviceCode: string) {
    const device = await this.devices.findOne({ where: { deviceCode } });
    if (!device) throw new NotFoundException('课堂设备不存在');
    return {
      service: 'kindergarten-classroom-local',
      serverNow: new Date().toISOString(),
      lanBaseUrl: this.config.get<string>('CLASSROOM_LAN_BASE_URL')?.trim() || null,
      deviceCode: device.deviceCode,
      online: this.isDeviceOnline(device),
    };
  }

  private async requireSession(
    actor: JwtTeacherPayload,
    rawToken: string,
    allowRevoked = false,
  ) {
    this.requireTeacher(actor);
    if (!rawToken?.trim()) throw new UnauthorizedException('缺少手机课堂控制会话');
    const session = await this.sessions.findOne({
      where: { tokenHash: this.hash(rawToken.trim()) },
    });
    if (!session || session.teacherId !== actor.sub)
      throw new UnauthorizedException('手机课堂控制会话无效');
    if (!allowRevoked && session.revokedAt)
      throw new UnauthorizedException('手机课堂控制会话已失效');
    if (session.expiresAt.getTime() <= Date.now()) {
      if (!session.revokedAt)
        await this.sessions.update(session.id, {
          revokedAt: new Date(),
          revokeReason: 'expired',
        });
      throw new GoneException('手机课堂控制会话已过期');
    }
    const run = await this.runRepository.findOne({
      where: { id: session.classroomRunId },
    });
    if (!run || run.teacherId !== actor.sub || run.classId !== session.classId)
      throw new ForbiddenException('当前教师无权控制该课堂');
    if (
      TERMINAL_CLASSROOM_RUN_STATUSES.includes(
        run.status as (typeof TERMINAL_CLASSROOM_RUN_STATUSES)[number],
      )
    ) {
      if (!session.revokedAt)
        await this.sessions.update(session.id, {
          revokedAt: new Date(),
          revokeReason: 'classroom_ended',
        });
      throw new GoneException('课堂已结束，手机控制权限已撤销');
    }
    if (run.deviceId !== session.screenDeviceId)
      throw new ConflictException('课堂已经切换大屏，请重新扫码连接');
    return { session, run };
  }

  private assertRunActive(run: ClassroomRun) {
    if (
      TERMINAL_CLASSROOM_RUN_STATUSES.includes(
        run.status as (typeof TERMINAL_CLASSROOM_RUN_STATUSES)[number],
      )
    )
      throw new GoneException('课堂已经结束');
  }

  private isDeviceOnline(device: Device | null) {
    if (!device) return false;
    if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status))
      return false;
    return (
      device.lastOnlineAt != null &&
      Date.now() - device.lastOnlineAt.getTime() <= this.heartbeatTimeoutMs
    );
  }

  private requireTeacher(actor: JwtTeacherPayload) {
    if (actor.userType !== AuthUserType.Teacher)
      throw new ForbiddenException('管理员不能直接控制正在进行的课堂');
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private errorMessage(error: unknown) {
    if (error && typeof error === 'object' && 'message' in error)
      return String((error as { message?: unknown }).message);
    return '实时课堂连接已断开';
  }
}
