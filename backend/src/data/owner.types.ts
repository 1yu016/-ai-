import { BadRequestException } from '@nestjs/common';
import type { JwtTeacherPayload } from '../auth/auth.types';

export enum OwnerType {
  Visitor = 'visitor',
  Teacher = 'teacher',
  Administrator = 'administrator',
}

export type DataOwner = {
  ownerType: OwnerType;
  ownerId: string;
};

export function resolveDataOwner(
  user?: JwtTeacherPayload,
  visitorId?: string,
): DataOwner | undefined {
  if (user) {
    return {
      ownerType: OwnerType.Teacher,
      ownerId: String(user.sub),
    };
  }

  const normalizedVisitorId = visitorId?.trim();
  if (normalizedVisitorId) {
    return {
      ownerType: OwnerType.Visitor,
      ownerId: normalizedVisitorId,
    };
  }

  return undefined;
}

export function requireDataOwner(
  user?: JwtTeacherPayload,
  visitorId?: string,
): DataOwner {
  const owner = resolveDataOwner(user, visitorId);
  if (!owner) {
    throw new BadRequestException('游客请求必须携带 visitorId');
  }
  return owner;
}
