import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { JwtTeacherPayload } from './auth.types';
import { Administrator } from './entities/administrator.entity';
import {
  AuthUserType,
  RefreshTokenSession,
} from './entities/refresh-token-session.entity';
import { AccountStatus, Teacher, TeacherRole } from './entities/teacher.entity';

export type LoginResult = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  userType: AuthUserType;
  teacherId?: number;
  administratorId?: number;
};

type LoginOptions = { deviceInfo?: string; ipAddress?: string };
type AuthIdentity = Teacher | Administrator;

function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim().toLowerCase());
  if (!match) throw new Error(`Token 有效期格式错误: ${value}`);
  const factors: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * factors[match[2] || 's'];
}

@Injectable()
export class AuthService {
  private readonly accessExpiresIn: number;
  private readonly refreshExpiresIn: number;

  constructor(
    @InjectRepository(Teacher) private readonly teachers: Repository<Teacher>,
    @InjectRepository(Administrator)
    private readonly administrators: Repository<Administrator>,
    @InjectRepository(RefreshTokenSession)
    private readonly refreshSessions: Repository<RefreshTokenSession>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.accessExpiresIn = parseDurationSeconds(
      this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ||
        this.config.get<string>('JWT_EXPIRES_IN') ||
        '15m',
    );
    this.refreshExpiresIn = parseDurationSeconds(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d',
    );
  }

  login(
    account: string,
    password: string,
    options: LoginOptions = {},
  ): Promise<LoginResult> {
    return this.loginUser(AuthUserType.Teacher, account, password, options);
  }

  loginAdministrator(
    account: string,
    password: string,
    options: LoginOptions = {},
  ): Promise<LoginResult> {
    return this.loginUser(
      AuthUserType.Administrator,
      account,
      password,
      options,
    );
  }

  private async loginUser(
    userType: AuthUserType,
    account: string,
    password: string,
    options: LoginOptions,
  ): Promise<LoginResult> {
    const repository =
      userType === AuthUserType.Teacher ? this.teachers : this.administrators;
    const alias =
      userType === AuthUserType.Teacher ? 'teacher' : 'administrator';
    const user = (await repository
      .createQueryBuilder(alias)
      .addSelect(`${alias}.passwordHash`)
      .where(`${alias}.account = :account`, { account: account.trim() })
      .getOne()) as AuthIdentity | null;
    if (
      !user ||
      !(await bcrypt.compare(password, user.passwordHash)) ||
      user.status !== AccountStatus.Active
    ) {
      throw new UnauthorizedException('账号或密码错误');
    }
    user.lastLoginAt = new Date();
    await (repository as Repository<AuthIdentity>).save(user);
    return this.issueTokenPair(userType, user, options);
  }

  async refresh(
    refreshToken: string,
    options: LoginOptions = {},
  ): Promise<LoginResult> {
    const tokenHash = this.hashToken(refreshToken);
    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(RefreshTokenSession);
      const session = await sessions.findOne({ where: { tokenHash } });
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('Refresh Token 无效或已过期');
      }
      const identity = await this.findIdentity(
        session.userType,
        session.userId,
        manager,
      );
      if (
        !identity ||
        identity.status !== AccountStatus.Active ||
        session.tokenVersion !== identity.tokenVersion
      ) {
        throw new UnauthorizedException('Refresh Token 无效或已过期');
      }
      const updated = await sessions
        .createQueryBuilder()
        .update(RefreshTokenSession)
        .set({ revokedAt: new Date() })
        .where('id = :id AND revoked_at IS NULL', { id: session.id })
        .execute();
      if (updated.affected !== 1)
        throw new UnauthorizedException('Refresh Token 已被使用');
      const result = await this.issueTokenPair(
        session.userType,
        identity,
        options,
        manager,
      );
      const replacement = await sessions.findOne({
        where: { tokenHash: this.hashToken(result.refresh_token) },
      });
      await sessions.update(session.id, {
        replacedBySessionId: replacement?.id ?? null,
      });
      return result;
    });
  }

  async logout(actor: JwtTeacherPayload, refreshToken: string): Promise<void> {
    const session = await this.refreshSessions.findOne({
      where: { tokenHash: this.hashToken(refreshToken) },
    });
    if (
      !session ||
      session.userId !== actor.sub ||
      session.userType !== actor.userType
    ) {
      throw new UnauthorizedException('Refresh Token 无效');
    }
    await this.refreshSessions.update(session.id, { revokedAt: new Date() });
    await this.bumpTokenVersion(actor.userType, actor.sub);
  }

  async logoutAll(actor: JwtTeacherPayload): Promise<void> {
    await this.bumpTokenVersion(actor.userType, actor.sub);
    await this.refreshSessions
      .createQueryBuilder()
      .update(RefreshTokenSession)
      .set({ revokedAt: new Date() })
      .where(
        'user_type = :userType AND user_id = :userId AND revoked_at IS NULL',
        { userType: actor.userType, userId: actor.sub },
      )
      .execute();
  }

  async validateAccessPayload(
    payload: JwtTeacherPayload,
  ): Promise<JwtTeacherPayload> {
    const userType = payload.userType ?? AuthUserType.Teacher;
    const identity = await this.findIdentity(userType, payload.sub);
    if (
      !identity ||
      identity.status !== AccountStatus.Active ||
      identity.tokenVersion !== (payload.tokenVersion ?? 0)
    ) {
      throw new UnauthorizedException('Token 无效或已过期');
    }
    return {
      ...payload,
      userType,
      tokenVersion: identity.tokenVersion,
      schoolId: identity.schoolId,
    };
  }

  private async issueTokenPair(
    userType: AuthUserType,
    identity: AuthIdentity,
    options: LoginOptions,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<LoginResult> {
    const payload: JwtTeacherPayload = {
      sub: identity.id,
      account: identity.account,
      name: identity.name,
      role:
        userType === AuthUserType.Administrator
          ? TeacherRole.Admin
          : (identity as Teacher).role,
      userType,
      tokenVersion: identity.tokenVersion,
      schoolId: identity.schoolId,
    };
    const refreshToken = randomBytes(48).toString('base64url');
    const sessions = manager.getRepository(RefreshTokenSession);
    await sessions.save(
      sessions.create({
        userType,
        userId: identity.id,
        tokenVersion: identity.tokenVersion,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshExpiresIn * 1000),
        revokedAt: null,
        replacedBySessionId: null,
        deviceInfo: options.deviceInfo?.trim() || null,
        ipAddress: options.ipAddress || null,
      }),
    );
    const result: LoginResult = {
      access_token: await this.jwtService.signAsync(payload),
      refresh_token: refreshToken,
      expires_in: this.accessExpiresIn,
      userType,
    };
    if (userType === AuthUserType.Teacher) result.teacherId = identity.id;
    else result.administratorId = identity.id;
    return result;
  }

  private async findIdentity(
    userType: AuthUserType,
    userId: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<AuthIdentity | null> {
    return userType === AuthUserType.Administrator
      ? manager.getRepository(Administrator).findOne({ where: { id: userId } })
      : manager.getRepository(Teacher).findOne({ where: { id: userId } });
  }

  private async bumpTokenVersion(
    userType: AuthUserType,
    userId: number,
  ): Promise<void> {
    if (userType === AuthUserType.Administrator)
      await this.administrators.increment({ id: userId }, 'tokenVersion', 1);
    else await this.teachers.increment({ id: userId }, 'tokenVersion', 1);
  }

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
