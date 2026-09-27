import type { Request } from 'express';
import type { TeacherRole } from './entities/teacher.entity';
import type { AuthUserType } from './entities/refresh-token-session.entity';

export type JwtTeacherPayload = {
  sub: number;
  account: string;
  name: string;
  role: TeacherRole;
  userType: AuthUserType;
  tokenVersion: number;
  schoolId?: string | null;
  iat?: number;
  exp?: number;
};

export type AuthenticatedRequest = Request & {
  user: JwtTeacherPayload;
};

export type OptionallyAuthenticatedRequest = Request & {
  user?: JwtTeacherPayload;
};
