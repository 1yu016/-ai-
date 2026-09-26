import type { Request } from 'express';
import type { TeacherRole } from './entities/teacher.entity';

export type JwtTeacherPayload = {
  sub: number;
  account: string;
  name: string;
  role: TeacherRole;
  iat?: number;
  exp?: number;
};

export type AuthenticatedRequest = Request & {
  user: JwtTeacherPayload;
};

export type OptionallyAuthenticatedRequest = Request & {
  user?: JwtTeacherPayload;
};
